import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  PayloadTooLargeException,
} from "@nestjs/common";
import { sensitiveFindings } from "@enterprise/shared";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/auth/auth.decorators";
import {
  GatewayErrorCode,
  GatewayService,
  gatewayErrorCode,
} from "../gateway/gateway.service";
import { UsersService } from "../users/users.service";
import { GovernanceService } from "../workspace/governance.service";
import { TASK_PREFIX_CAPABILITY, documentInput } from "./embedding-text";
import { extractSections, fileType } from "./knowledge-base.sections";
import type { KnowledgeSettingsDto } from "./knowledge-base.dto";
import { KnowledgeService, RATE_LIMIT_BACKOFF_MS } from "./knowledge.service";
import {
  RagEngineClient,
  type EngineConfig,
  type EngineNext,
  type PauseReason,
} from "./rag-engine.client";

const MB = 1024 * 1024;
/** Extracted text sent to the engine per upload (the engine accepts 2 MB of JSON). */
const MAX_UPLOAD_JSON = 1.5 * MB;
/** Passages fetched per indexing step; one embedding request each (fewer for paced external models). */
const INDEX_BATCH = { maxItems: 32, maxBytes: 200_000 };
const TICK_MS = 60_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Why an embedding call was refused, as the engine records it on the paused documents. */
export function pauseReason(error: unknown): PauseReason {
  const code = gatewayErrorCode(error);
  if (code === GatewayErrorCode.creditExhausted) return "CREDIT_EXHAUSTED";
  if (code === GatewayErrorCode.rateLimited) return "RATE_LIMITED";
  if (code === GatewayErrorCode.modelNotEntitled) return "MODEL_UNAVAILABLE";
  // The administrator's external-provider kill switch (governance.reserve).
  if (error instanceof ForbiddenException) return "POLICY";
  // This deployment's quotas and daily external limits (governance.reserve).
  if (error instanceof HttpException && error.getStatus() === 429)
    return "DAILY_LIMIT";
  return "ERROR";
}

/**
 * The tenant side of the central knowledge base. Files are parsed here; the engine stores, chunks
 * and searches them. Embedding also happens here, through KnowledgeService's metered path, so the
 * customer's credit, quotas, kill switch and usage history apply to indexing as they do to chat.
 */
@Injectable()
export class KnowledgeBaseService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private running: Promise<void> | null = null;
  private again = false;
  private timer?: NodeJS.Timeout;
  private dailyLimitOn?: string;

  constructor(
    private readonly engine: RagEngineClient,
    private readonly knowledge: KnowledgeService,
    private readonly users: UsersService,
    private readonly governance: GovernanceService,
    private readonly audit: AuditService,
    private readonly gateway: GatewayService,
  ) {}

  onApplicationBootstrap() {
    if (!this.engine.enabled()) return;
    // Resume after a restart, then keep checking for paused work that can continue.
    setTimeout(() => void this.tick(), 5_000).unref();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Limits, settings, usage and the embedding models this tenant may choose. */
  async overview() {
    const config = await this.engine.request<EngineConfig>("/v1/config");
    const embeddingModels = await Promise.all(
      config.limits.embeddingModels.map(async (id) => {
        const { model, problem } = await this.knowledge.embeddingModel(id);
        return {
          id,
          displayName: model?.displayName ?? id,
          local: model?.local ?? null,
          problem,
        };
      }),
    );
    return { ...config, embeddingModels };
  }

  documents() {
    return this.engine.request<unknown[]>("/v1/documents");
  }

  async upload(
    auth: AuthUser,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
    acknowledgeSensitive = false,
  ) {
    if (!file?.size)
      throw new BadRequestException("Attach a document in the 'file' field");
    const config = await this.engine.request<EngineConfig>("/v1/config");
    const type = fileType(file.originalname);
    if (!type || !config.limits.allowedTypes.includes(type))
      throw new BadRequestException(
        `Your plan allows these file types: ${config.limits.allowedTypes.join(", ")}`,
      );
    if (file.size > config.limits.maxFileMb * MB)
      throw new PayloadTooLargeException(
        `Files can be up to ${config.limits.maxFileMb} MB on your plan`,
      );
    const { model, problem } = await this.knowledge.embeddingModel(
      config.settings.embeddingModel,
    );
    if (!model || problem)
      throw new BadRequestException(`Cannot index documents: ${problem}`);
    const sections = await extractSections(file.originalname, file.buffer, type);
    const text = sections
      .map((section) => [section.title, section.text].filter(Boolean).join("\n"))
      .join("\n\n");
    // Every document's text leaves this deployment for an external embedding provider.
    if (!model.local) {
      await this.externalAllowed();
      await this.governance.checkSensitive(text, acknowledgeSensitive);
    }
    const actor = await this.users.syncUser(auth);
    const filename = file.originalname.slice(0, 255);
    const body = {
      filename,
      type,
      fileBytes: file.size,
      sections,
      // Recorded so a later switch to an external model can ask for the same review.
      sensitiveFindings: sensitiveFindings(text).length,
      requestedBy: { userId: actor.id, roles: auth.roles },
    };
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_UPLOAD_JSON)
      throw new PayloadTooLargeException(
        "This document has too much text for one upload; split it into smaller files",
      );
    const created = await this.engine.request<{ id: string; chunks: number }>(
      "/v1/documents",
      { method: "POST", body, timeoutMs: 60_000 },
    );
    await this.audit.record({
      actorId: actor.id,
      action: "KNOWLEDGE_DOCUMENT_UPLOAD",
      entityType: "KnowledgeDocument",
      entityId: created.id,
      after: {
        filename,
        type,
        fileBytes: file.size,
        chunks: created.chunks,
        sensitiveFindings: body.sensitiveFindings,
      },
    });
    this.kick();
    return created;
  }

  async updateSettings(auth: AuthUser, dto: KnowledgeSettingsDto) {
    const { acknowledgeSensitive, ...changes } = dto;
    const config = await this.engine.request<EngineConfig>("/v1/config");
    if (
      changes.embeddingModel &&
      changes.embeddingModel !== config.settings.embeddingModel
    ) {
      const { model, problem } = await this.knowledge.embeddingModel(
        changes.embeddingModel,
      );
      if (!model || problem)
        throw new BadRequestException(
          `Cannot use ${changes.embeddingModel}: ${problem}`,
        );
      // Re-indexing sends every stored document to that provider.
      if (!model.local) {
        await this.externalAllowed();
        const flagged = config.usage.sensitiveDocuments;
        const { sensitiveMode } = await this.governance.settings();
        if (flagged && (sensitiveMode === "BLOCK" || !acknowledgeSensitive))
          throw new BadRequestException({
            message: `${sensitiveMode === "BLOCK" ? "Blocked" : "Review required"}: ${flagged} document(s) contain sensitive information and would be sent to ${model.displayName}.`,
            code: "SENSITIVE_CONTEXT",
            findings: [`${flagged} document(s) with sensitive information`],
            canAcknowledge: sensitiveMode === "WARN",
          });
      }
    }
    const actor = await this.users.syncUser(auth);
    const result = await this.engine.request<{ reindex: boolean }>(
      "/v1/settings",
      {
        method: "PATCH",
        body: { ...changes, requestedBy: { userId: actor.id, roles: auth.roles } },
        timeoutMs: 60_000,
      },
    );
    await this.audit.record({
      actorId: actor.id,
      action: "KNOWLEDGE_SETTINGS_UPDATE",
      entityType: "KnowledgeSettings",
      entityId: config.tenant,
      before: config.settings,
      after: { ...config.settings, ...changes },
    });
    if (result.reindex) this.kick();
    return { ...result, overview: await this.overview() };
  }

  async setEnabled(auth: AuthUser, id: string, enabled: boolean) {
    const result = await this.engine.request(`/v1/documents/${id}`, {
      method: "PATCH",
      body: { enabled },
    });
    await this.recordDocument(auth, enabled ? "KNOWLEDGE_DOCUMENT_ENABLE" : "KNOWLEDGE_DOCUMENT_DISABLE", id);
    return result;
  }

  async remove(auth: AuthUser, id: string) {
    const result = await this.engine.request(`/v1/documents/${id}`, {
      method: "DELETE",
    });
    await this.recordDocument(auth, "KNOWLEDGE_DOCUMENT_DELETE", id);
    return result;
  }

  async retry(auth: AuthUser, id: string) {
    const result = await this.engine.request(`/v1/documents/${id}/retry`, {
      method: "POST",
      body: {},
    });
    await this.recordDocument(auth, "KNOWLEDGE_DOCUMENT_RETRY", id);
    this.kick();
    return result;
  }

  private async recordDocument(auth: AuthUser, action: string, id: string) {
    const actor = await this.users.syncUser(auth);
    await this.audit.record({
      actorId: actor.id,
      action,
      entityType: "KnowledgeDocument",
      entityId: id,
    });
  }

  private async externalAllowed() {
    if ((await this.governance.settings()).externalBlocked)
      throw new ForbiddenException(
        "External providers are paused by the administrator",
      );
  }

  /** Starts indexing pending passages, unless a run is already going (it then runs once more). */
  kick() {
    if (!this.engine.enabled()) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.indexPending();
      } while (this.again);
    })()
      .catch((error: Error) =>
        this.logger.warn(`Knowledge indexing stopped: ${error.message}`),
      )
      .finally(() => {
        this.running = null;
      });
  }

  /** Resolves when the current indexing run (if any) has finished. */
  idle() {
    return this.running ?? Promise.resolve();
  }

  /** Resumes documents paused for reasons that may have cleared, and indexes what is pending. */
  async tick() {
    try {
      const config = await this.engine.request<EngineConfig>("/v1/config");
      if (config.usage.pausedDocuments) {
        // Provider rate limits clear within a minute; the daily limit on the next UTC day.
        const reasons: PauseReason[] = ["RATE_LIMITED"];
        const credit = await this.gateway.credit().catch(() => null);
        if (!credit?.exhausted) reasons.push("CREDIT_EXHAUSTED");
        if (this.dailyLimitOn !== utcDay()) reasons.push("DAILY_LIMIT");
        await this.engine.request("/v1/index/resume", {
          method: "POST",
          body: { reasons },
        });
      }
      if (config.usage.pendingChunks || config.usage.pausedDocuments) this.kick();
    } catch (error) {
      this.logger.warn(
        `Knowledge indexing check failed: ${(error as Error).message}`,
      );
    }
  }

  private pause(reason: PauseReason) {
    if (reason === "DAILY_LIMIT") this.dailyLimitOn = utcDay();
    return this.engine.request("/v1/index/pause", {
      method: "POST",
      body: { reason },
    });
  }

  private async indexPending() {
    for (;;) {
      const next = await this.engine.request<EngineNext>(
        `/v1/index/next?maxItems=${INDEX_BATCH.maxItems}&maxBytes=${INDEX_BATCH.maxBytes}`,
      );
      if (!next.items.length) {
        if (next.problem && next.remaining) await this.pause("MODEL_UNAVAILABLE");
        return;
      }
      const { model, problem } = await this.knowledge.embeddingModel(next.model);
      if (!model || problem || !next.requestedBy) {
        this.logger.warn(`Knowledge indexing paused: ${problem ?? "no requester"}`);
        await this.pause("MODEL_UNAVAILABLE");
        return;
      }
      if (!model.local && (await this.governance.settings()).externalBlocked) {
        await this.pause("POLICY");
        return;
      }
      const items = next.items.slice(0, this.knowledge.batchSize(model));
      const taskPrefix = model.capabilities.includes(TASK_PREFIX_CAPABILITY);
      let vectors: number[][];
      try {
        vectors = await this.knowledge.embedTexts({
          requestId: `rag-index:${randomUUID()}`,
          userId: next.requestedBy.userId,
          roles: next.requestedBy.roles,
          conversationId: null,
          model,
          texts: items.map((item) => documentInput(item.title, item.text, taskPrefix)),
          rateLimitWaitMs: model.local ? 0 : RATE_LIMIT_BACKOFF_MS,
        });
      } catch (error) {
        const reason = pauseReason(error);
        this.logger.warn(
          `Knowledge indexing paused (${reason}): ${(error as Error).message}`,
        );
        await this.pause(reason);
        return;
      }
      try {
        await this.engine.request("/v1/index/vectors", {
          method: "POST",
          body: {
            version: next.version,
            model: next.model,
            items: items.map((item, i) => ({
              chunkId: item.chunkId,
              vector: vectors[i],
            })),
          },
          timeoutMs: 30_000,
        });
      } catch (error) {
        // Settings changed while embedding: those vectors are for an old version. Fetch again.
        if (error instanceof ConflictException) continue;
        throw error;
      }
      if (!model.local) await sleep(this.knowledge.externalBatchIntervalMs());
    }
  }
}
