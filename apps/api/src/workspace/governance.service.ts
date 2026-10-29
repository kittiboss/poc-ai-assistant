import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, Provider } from "@prisma/client";
import { sensitiveFindings, toCsv } from "@enterprise/shared";
import Big from "big.js";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import { EXTERNAL_PROVIDERS, vendorGateway } from "../models/model-policies";
import { UsersService } from "../users/users.service";
import { externalDailyLimits, startOfUtcDay } from "../usage/external-limits";
import type { GovernanceDto, QuotaDto } from "./workspace.dto";

/** Code of a refusal by a daily or per-request quota; its `quota` field carries the numbers. */
export const QUOTA_EXCEEDED = "QUOTA_EXCEEDED";
/** Which quota refused: a QuotaPolicy (USER, ROLE, MODEL, DEPARTMENT) or the installation's external limit. */
type QuotaLimit = {
  scope: string;
  subject: string;
  unit: "requests" | "tokens";
  period: "day" | "request";
};

export const GOVERNANCE_DEFAULTS: GovernanceDto = {
  externalBlocked: false,
  retentionDays: 0,
  sensitiveMode: "WARN",
};

@Injectable()
export class GovernanceService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(GovernanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.purgeExpired().catch(() =>
          this.logger.error("Retention sweep failed"),
        ),
      3600_000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async settings(): Promise<GovernanceDto> {
    const row = await this.prisma.applicationSetting.findUnique({
      where: { key: "governance" },
    });
    return {
      ...GOVERNANCE_DEFAULTS,
      ...((row?.value as Partial<GovernanceDto>) || {}),
    };
  }
  async saveSettings(auth: AuthUser, dto: GovernanceDto) {
    const actor = await this.users.syncUser(auth);
    const before = await this.settings();
    await this.prisma.$transaction([
      this.prisma.applicationSetting.upsert({
        where: { key: "governance" },
        update: { value: { ...dto } },
        create: { key: "governance", value: { ...dto } },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: "GOVERNANCE_UPDATE",
          entityType: "ApplicationSetting",
          entityId: "governance",
          before: { ...before },
          after: { ...dto },
        },
      }),
    ]);
    return dto;
  }
  async checkSensitive(text: string, acknowledged = false) {
    const findings = sensitiveFindings(text);
    if (findings.length) {
      const settings = await this.settings();
      if (settings.sensitiveMode === "BLOCK" || !acknowledged)
        throw new BadRequestException({
          message: `${settings.sensitiveMode === "BLOCK" ? "Blocked" : "Review required"}: sensitive information detected in the complete model context (${findings.join(", ")}).`,
          code: "SENSITIVE_CONTEXT",
          findings,
          canAcknowledge: settings.sensitiveMode === "WARN",
        });
    }
  }
  async reserve(args: {
    requestId: string;
    userId: string;
    modelId: string;
    roles: string[];
    external: boolean;
    input: string;
    outputTokens: number;
  }) {
    const tokens =
      Buffer.byteLength(args.input, "utf8") + args.outputTokens + 512;
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize admissions, including simultaneous comparison requests, across API instances.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(72196511)`;
        const setting = await tx.applicationSetting.findUnique({
          where: { key: "governance" },
        });
        if (
          args.external &&
          (setting?.value as { externalBlocked?: boolean })?.externalBlocked
        )
          throw new ForbiddenException(
            "External providers are paused by the administrator",
          );
        const user = await tx.user.findUniqueOrThrow({
          where: { id: args.userId },
        });
        const active = { expiresAt: { gt: new Date() } };
        const today = { gte: startOfUtcDay() };
        const price = await tx.pricingVersion.findFirst({
          where: {
            configuration: { modelId: args.modelId },
            effectiveAt: { lte: new Date() },
          },
          orderBy: [{ effectiveAt: "desc" }, { version: "desc" }],
        });
        const maxRate = price
          ? Big(price.simulationInputRate.toString()).gt(
              price.simulationOutputRate.toString(),
            )
            ? price.simulationInputRate
            : price.simulationOutputRate
          : 0;
        const simulatedCost = Big(maxRate.toString())
          .times(tokens)
          .div(1_000_000);
        const policies = await tx.quotaPolicy.findMany({
          where: {
            OR: [
              { scope: "USER", subject: args.userId },
              { scope: "ROLE", subject: { in: args.roles } },
              { scope: "MODEL", subject: args.modelId },
              ...(user.department
                ? [{ scope: "DEPARTMENT", subject: user.department }]
                : []),
            ],
          },
        });
        // The numbers let the web say how much this request needs and how much is left.
        const check = (
          used: number,
          reserved: number,
          incoming: number,
          limit: number | null,
          label: string,
          quota: QuotaLimit,
        ) => {
          if (limit !== null && used + reserved + incoming > limit)
            throw new HttpException(
              {
                statusCode: 429,
                code: QUOTA_EXCEEDED,
                message: `${label} quota would be exceeded: this request needs up to ${incoming}, ${Math.max(0, limit - used - reserved)} of ${limit} left. Reservations include a conservative input estimate and maximum output.`,
                quota: {
                  ...quota,
                  limit,
                  used: used + reserved,
                  needed: incoming,
                  resetsAt: new Date(today.gte.getTime() + 86_400_000),
                },
              },
              429,
            );
        };
        for (const policy of policies) {
          const where: Prisma.UsageRecordWhereInput =
            policy.scope === "USER"
              ? { userId: args.userId }
              : policy.scope === "MODEL"
                ? { modelId: args.modelId }
                : policy.scope === "ROLE"
                  ? {
                      user: {
                        roles: { some: { role: { name: policy.subject } } },
                      },
                    }
                  : { user: { department: policy.subject } };
          const pending: Prisma.UsageReservationWhereInput =
            policy.scope === "USER"
              ? { userId: args.userId }
              : policy.scope === "MODEL"
                ? { modelId: args.modelId }
                : policy.scope === "ROLE"
                  ? { roles: { has: policy.subject } }
                  : { department: policy.subject };
          const [used, reserved] = await Promise.all([
            tx.usageRecord.aggregate({
              where: { ...where, createdAt: today },
              _count: true,
              _sum: { totalTokens: true, simulatedProviderCost: true },
            }),
            tx.usageReservation.aggregate({
              where: { ...pending, ...active },
              _count: true,
              _sum: { tokens: true, simulatedCost: true },
            }),
          ]);
          const label = `${policy.scope} ${policy.subject}`;
          const scope = { scope: policy.scope, subject: policy.subject };
          check(
            0,
            0,
            tokens,
            policy.perRequestTokens,
            `${label} per-request tokens`,
            { ...scope, unit: "tokens", period: "request" },
          );
          check(
            used._count,
            reserved._count,
            1,
            policy.dailyRequests,
            `${label} daily requests`,
            { ...scope, unit: "requests", period: "day" },
          );
          check(
            used._sum.totalTokens || 0,
            reserved._sum.tokens || 0,
            tokens,
            policy.dailyTokens,
            `${label} daily tokens`,
            { ...scope, unit: "tokens", period: "day" },
          );
          if (policy.dailySimulatedBudget !== null) {
            if (price?.currency !== "USD")
              throw new BadRequestException(
                "Simulated budgets require model pricing in USD",
              );
            const total = Big(used._sum.simulatedProviderCost?.toString() || 0)
              .plus(reserved._sum.simulatedCost?.toString() || 0)
              .plus(simulatedCost);
            if (total.gt(policy.dailySimulatedBudget.toString()))
              throw new HttpException(
                `${label} daily simulated budget would be exceeded`,
                429,
              );
          }
        }
        if (args.external) {
          const [used, reserved] = await Promise.all([
            tx.usageRecord.aggregate({
              where: {
                createdAt: today,
                provider: { in: [...EXTERNAL_PROVIDERS] as Provider[] },
              },
              _count: true,
              _sum: { totalTokens: true },
            }),
            tx.usageReservation.aggregate({
              where: { external: true, ...active },
              _count: true,
              _sum: { tokens: true },
            }),
          ]);
          const limits = externalDailyLimits();
          const scope = { scope: "INSTALLATION", subject: "external" };
          check(
            used._count,
            reserved._count,
            1,
            limits.requests,
            "Installation external requests",
            { ...scope, unit: "requests", period: "day" },
          );
          check(
            used._sum.totalTokens || 0,
            reserved._sum.tokens || 0,
            tokens,
            limits.tokens,
            "Installation external tokens",
            { ...scope, unit: "tokens", period: "day" },
          );
        }
        await tx.usageReservation.create({
          data: {
            id: args.requestId,
            userId: user.id,
            modelId: args.modelId,
            department: user.department,
            roles: args.roles,
            external: args.external,
            tokens,
            simulatedCost: simulatedCost.toString(),
            expiresAt: new Date(Date.now() + 10 * 60_000),
          },
        });
      },
      { timeout: 15000 },
    );
  }
  release(id: string) {
    return this.prisma.usageReservation.deleteMany({ where: { id } });
  }
  async saveQuota(auth: AuthUser, dto: QuotaDto) {
    const actor = await this.users.syncUser(auth);
    if (dto.scope === "ROLE" && !["ADMIN", "USER"].includes(dto.subject))
      throw new BadRequestException("Unknown role");
    if (
      dto.scope === "USER" &&
      !(await this.prisma.user.findUnique({ where: { id: dto.subject } }))
    )
      throw new BadRequestException("Unknown user");
    if (
      dto.scope === "MODEL" &&
      !(await this.prisma.aIModel.findUnique({ where: { id: dto.subject } }))
    )
      throw new BadRequestException("Unknown model");
    const data = {
      ...dto,
      dailyRequests: dto.dailyRequests ?? null,
      dailyTokens: dto.dailyTokens ?? null,
      perRequestTokens: dto.perRequestTokens ?? null,
      dailySimulatedBudget: dto.dailySimulatedBudget ?? null,
    };
    const result = await this.prisma.quotaPolicy.upsert({
      where: { scope_subject: { scope: dto.scope, subject: dto.subject } },
      create: data,
      update: data,
    });
    await this.audit.record({
      actorId: actor.id,
      action: "QUOTA_SAVE",
      entityType: "QuotaPolicy",
      entityId: result.id,
      after: result,
    });
    return result;
  }
  async deleteQuota(auth: AuthUser, id: string) {
    const actor = await this.users.syncUser(auth);
    await this.prisma.quotaPolicy.deleteMany({ where: { id } });
    await this.audit.record({
      actorId: actor.id,
      action: "QUOTA_DELETE",
      entityType: "QuotaPolicy",
      entityId: id,
    });
    return { deleted: true };
  }
  async department(auth: AuthUser, id: string, department: string) {
    const actor = await this.users.syncUser(auth);
    await this.prisma.user.update({
      where: { id },
      data: { department: department.trim() },
    });
    await this.audit.record({
      actorId: actor.id,
      action: "DEPARTMENT_UPDATE",
      entityType: "User",
      entityId: id,
      after: { department },
    });
    return { department };
  }
  async dashboard() {
    const [settings, policies, users, feedback, recentFeedback] =
      await Promise.all([
        this.settings(),
        this.prisma.quotaPolicy.findMany(),
        this.prisma.user.findMany({
          select: { id: true, username: true, department: true },
        }),
        this.prisma.message.groupBy({
          by: ["modelId", "feedback"],
          where: { feedback: { not: null } },
          _count: true,
        }),
        this.prisma.message.findMany({
          where: { feedback: { not: null } },
          select: {
            id: true,
            modelId: true,
            feedback: true,
            feedbackComment: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
      ]);
    const departments = [
      ...new Set(users.map((u) => u.department).filter(Boolean)),
    ];
    const departmentUsage = await Promise.all(
      departments.map(async (department) => ({
        department,
        ...(await this.prisma.usageRecord.aggregate({
          where: { user: { department }, createdAt: { gte: startOfUtcDay() } },
          _count: true,
          _sum: { totalTokens: true, simulatedProviderCost: true },
        })),
      })),
    );
    return {
      settings,
      policies,
      users,
      feedback,
      recentFeedback,
      departmentUsage,
    };
  }
  async usageCsv(auth: AuthUser, admin = false) {
    const actor = await this.users.syncUser(auth);
    const rows = await this.prisma.usageRecord.findMany({
      where: admin ? {} : { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const allColumns = [
      "createdAt",
      "requestId",
      "userId",
      "modelId",
      "provider",
      "inputTokens",
      "outputTokens",
      "durationMs",
      "status",
      "usageKind",
      "currency",
      "actualProviderCost",
      "customerCharge",
      "simulatedProviderCost",
      "simulatedCustomerCharge",
    ] as const;
    const columns = allColumns.filter((key) => !vendorGateway() || !['actualProviderCost', 'simulatedProviderCost'].includes(key));
    return {
      filename: "usage.csv",
      content: toCsv([
        Array.from(columns),
        ...rows.map((r) =>
          columns.map((key) =>
            key === "createdAt" ? r.createdAt.toISOString() : String(r[key]),
          ),
        ),
      ]),
    };
  }
  async retentionPreview() {
    const { retentionDays } = await this.settings();
    const cutoff = new Date(Date.now() - retentionDays * 86400_000);
    return {
      retentionDays,
      cutoff: retentionDays ? cutoff : null,
      conversations: retentionDays
        ? await this.prisma.conversation.count({
            where: { updatedAt: { lt: cutoff }, messages: { some: {} } },
          })
        : 0,
    };
  }
  async purgeExpired() {
    const { retentionDays } = await this.settings();
    if (!retentionDays) return { purged: 0 };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72196512)`;
      const chats = await tx.conversation.findMany({
        where: {
          updatedAt: { lt: new Date(Date.now() - retentionDays * 86400_000) },
          messages: { some: {} },
        },
        select: { id: true },
        take: 500,
      });
      const ids = chats.map((c) => c.id);
      await tx.message.deleteMany({ where: { conversationId: { in: ids } } });
      await tx.conversation.updateMany({
        where: { id: { in: ids } },
        data: { title: "Expired conversation", deletedAt: new Date() },
      });
      await tx.usageReservation.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (ids.length)
        await tx.auditLog.create({
          data: {
            action: "RETENTION_PURGE",
            entityType: "Conversation",
            entityId: "retention",
            after: { count: ids.length, retentionDays },
          },
        });
      return { purged: ids.length };
    });
  }
}
