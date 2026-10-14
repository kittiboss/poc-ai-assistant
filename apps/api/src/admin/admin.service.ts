import { Injectable } from '@nestjs/common';
import { Prisma, type Provider } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { externalDailyLimits } from '../usage/external-limits';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';

export type SummaryFilters = { from?: string; to?: string; provider?: Provider; modelId?: string };

/** Aggregates and access management only; never returns conversation content. */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly users: UsersService, private readonly usage: UsageService, private readonly audit: AuditService) {}

  async summary(filters: SummaryFilters = {}) {
    const createdAt = filters.from || filters.to ? { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } : undefined;
    const where: Prisma.UsageRecordWhereInput = { ...(filters.provider ? { provider: filters.provider } : {}), ...(filters.modelId ? { modelId: filters.modelId } : {}), ...(createdAt ? { createdAt } : {}) };
    const conditions = [Prisma.sql`TRUE`];
    if (filters.from) conditions.push(Prisma.sql`"createdAt" >= ${new Date(filters.from)}`);
    if (filters.to) conditions.push(Prisma.sql`"createdAt" <= ${new Date(filters.to)}`);
    if (filters.provider) conditions.push(Prisma.sql`"provider" = ${filters.provider}::"Provider"`);
    if (filters.modelId) conditions.push(Prisma.sql`"modelId" = ${filters.modelId}`);
    const costSum = { actualProviderCost: true, customerCharge: true, simulatedProviderCost: true, simulatedCustomerCharge: true } as const;
    const [users, activeUsers, requests, tokens, byProvider, byModel, byKind, costs, daily, models, externalToday] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.usageRecord.groupBy({ by: ['userId'], where }).then((rows) => rows.length),
      this.prisma.usageRecord.count({ where }),
      this.prisma.usageRecord.aggregate({ where, _sum: { inputTokens: true, outputTokens: true, totalTokens: true } }),
      this.prisma.usageRecord.groupBy({ by: ['provider'], where, _count: true, _sum: { totalTokens: true, ...costSum } }),
      this.prisma.usageRecord.groupBy({ by: ['modelId'], where, _count: true, _sum: { totalTokens: true, ...costSum } }),
      this.prisma.usageRecord.groupBy({ by: ['usageKind'], where, _count: true, _sum: { totalTokens: true } }),
      this.prisma.usageRecord.aggregate({ where, _sum: costSum }),
      this.prisma.$queryRaw<Array<{ day: Date; requests: number; tokens: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS requests, COALESCE(SUM("totalTokens"), 0)::bigint AS tokens
        FROM "UsageRecord" WHERE ${Prisma.join(conditions, ' AND ')} GROUP BY 1 ORDER BY 1`,
      this.prisma.aIModel.findMany({ select: { id: true, displayName: true } }),
      this.usage.externalUsageToday(),
    ]);
    const names = new Map(models.map((model) => [model.id, model.displayName]));
    return {
      users, activeUsers, requests, tokens: tokens._sum, byProvider, byKind, costs: costs._sum,
      byModel: byModel.map((row) => ({ ...row, displayName: names.get(row.modelId) || row.modelId })),
      daily: daily.map((row) => ({ day: row.day.toISOString().slice(0, 10), requests: row.requests, tokens: Number(row.tokens) })),
      externalToday: { used: externalToday, limits: externalDailyLimits() },
    };
  }

  listUsers() {
    return this.prisma.user.findMany({ select: { id: true, username: true, email: true, createdAt: true, roles: { include: { role: true } }, modelPermissions: true }, orderBy: { username: 'asc' } });
  }

  async setModelPermission(auth: AuthUser, userId: string, modelId: string, allowed: boolean) {
    const actor = await this.users.syncUser(auth);
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const result = await this.prisma.userModelPermission.upsert({ where: { userId_modelId: { userId, modelId } }, update: { allowed }, create: { userId, modelId, allowed } });
    await this.audit.record({ actorId: actor.id, action: 'MODEL_PERMISSION_UPDATE', entityType: 'UserModelPermission', entityId: `${userId}:${modelId}`, after: result });
    return result;
  }
}
