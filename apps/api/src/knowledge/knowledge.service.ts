import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { type AIModel, RequestStatus, UsageOperation } from "@prisma/client";
import {
  ProductCsvError,
  parseProductCsv,
  productPassage,
} from "@enterprise/shared";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import { GatewayService } from "../gateway/gateway.service";
import {
  credentialFor,
  externalProviderAllowed,
} from "../models/model-policies";
import { UsageService } from "../usage/usage.service";
import { UsersService } from "../users/users.service";
import { GovernanceService } from "../workspace/governance.service";
import {
  EMBEDDING_DIMENSIONS,
  OUTPUT_DIMENSIONS_CAPABILITY,
  TASK_PREFIX_CAPABILITY,
  contentHash,
  documentInput,
  queryInput,
  vectorLiteral,
} from "./embedding-text";

export const PRODUCT_SOURCE = "products";
/**
 * Gemini accepts at most 100 texts per batchEmbedContents call, and its free tier counts every
 * text as one request against a 100-per-minute quota. External indexing therefore sends small
 * batches at a steady pace (default 25 texts every 15.5 s); small batches also keep each
 * governance reservation, which conservatively counts input bytes as tokens, well inside the
 * daily external token limit. A provider rate limit waits a full minute and retries.
 */
const MAX_EMBEDDING_BATCH = 100;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 61_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/** Progress of the current or most recent indexing run, reported by status(). */
export type IndexRun = {
  embeddingModel: string;
  pending: number;
  embedded: number;
  removed: number;
  batches: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

/** Shape-compatible with workspace citations, so chat stores and renders both the same way. */
export type ProductCitation = {
  id: string;
  sourceId: string;
  filename: string;
  page: null;
  content: string;
  kind: "product";
  score: number;
};

type EmbeddingCall = {
  requestId: string;
  userId: string;
  roles: string[];
  conversationId: string | null;
  model: AIModel;
  texts: string[];
  /** Wait this long and retry when the provider rate-limits (0: fail immediately). */
  rateLimitWaitMs?: number;
};

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private indexing = false;
  private run: IndexRun | null = null;
  private current: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly gateway: GatewayService,
    private readonly usage: UsageService,
    private readonly governance: GovernanceService,
    private readonly audit: AuditService,
  ) {}

  embeddingModelId() {
    return process.env.RAG_EMBEDDING_MODEL || "mock-embedding";
  }

  /** Texts per embedding request: the provider maximum locally, smaller and paced for external models. */
  batchSize(model: AIModel) {
    if (model.local) return MAX_EMBEDDING_BATCH;
    const configured = Number(process.env.RAG_EXTERNAL_BATCH_SIZE ?? 25);
    return Number.isInteger(configured)
      ? Math.min(MAX_EMBEDDING_BATCH, Math.max(1, configured))
      : 25;
  }

  /** Pause between external embedding batches; local models are never paced. */
  externalBatchIntervalMs() {
    const configured = Number(
      process.env.RAG_EXTERNAL_BATCH_INTERVAL_MS ?? 15_500,
    );
    return Number.isFinite(configured) && configured >= 0 ? configured : 15_500;
  }

  /** Resolves when the current background indexing run (if any) has finished. */
  idle() {
    return this.current;
  }

  topK() {
    const configured = Number(process.env.RAG_TOP_K || 5);
    return Number.isInteger(configured)
      ? Math.min(10, Math.max(1, configured))
      : 5;
  }

  /** Resolves the configured embedding model without calling any provider; `problem` explains why it cannot be used. */
  async embeddingModel() {
    const id = this.embeddingModelId();
    const model = await this.prisma.aIModel.findUnique({ where: { id } });
    const problem = !model
      ? `embedding model ${id} is not in the registry`
      : !model.capabilities.includes("embedding")
        ? `${id} is not an embedding model`
        : !model.enabled
          ? `${model.displayName} is disabled in the model registry`
          : !externalProviderAllowed(
                model.provider,
                process.env.ENABLE_EXTERNAL_PROVIDERS === "true",
                credentialFor(model.provider),
              )
            ? `${model.displayName} is not explicitly enabled and configured on the server`
            : null;
    return { id, model, problem };
  }

  async status() {
    const { id, model, problem } = await this.embeddingModel();
    const plan = await this.plan(
      id,
      Boolean(model?.capabilities.includes(TASK_PREFIX_CAPABILITY)),
    );
    const indexed = plan.total - plan.stale.length;
    return {
      /** The embedding model can be used now (indexing is possible). */
      ready: !problem,
      available: !problem && indexed > 0,
      problem:
        problem ||
        (indexed === 0 ? "the product catalog has not been indexed yet" : null),
      embeddingModel: model
        ? {
            id: model.id,
            displayName: model.displayName,
            provider: model.provider,
            local: model.local,
          }
        : { id, displayName: id, provider: null, local: null },
      products: plan.total,
      indexed,
      stale: plan.stale.length,
      orphaned: plan.orphaned.length,
      indexing: this.indexing,
      lastRun: this.run,
    };
  }

  /** Upserts the catalog from CSV. Embedding is a separate, explicit step because it may call a provider. */
  async importProducts(auth: AuthUser, csv: string) {
    let products;
    try {
      products = parseProductCsv(csv);
    } catch (error) {
      if (error instanceof ProductCsvError)
        throw new BadRequestException({
          message: error.message,
          errors: error.errors,
        });
      throw error;
    }
    const actor = await this.users.syncUser(auth);
    const existing = await this.prisma.product.findMany({
      select: { productId: true, sku: true },
    });
    const ids = new Set(existing.map((product) => product.productId));
    const skuOwner = new Map(
      existing.map((product) => [product.sku, product.productId]),
    );
    const conflicts = products.filter(
      (product) =>
        skuOwner.has(product.sku) &&
        skuOwner.get(product.sku) !== product.productId,
    );
    if (conflicts.length)
      throw new BadRequestException({
        message: `SKU already belongs to another product_id: ${conflicts
          .slice(0, 5)
          .map((product) => product.sku)
          .join(", ")}`,
        errors: conflicts.map(
          (product) =>
            `${product.sku} is product_id ${skuOwner.get(product.sku)}, not ${product.productId}`,
        ),
      });
    await this.prisma.$transaction(
      products.map((product) =>
        this.prisma.product.upsert({
          where: { productId: product.productId },
          create: product,
          update: product,
        }),
      ),
    );
    const result = {
      rows: products.length,
      created: products.filter((product) => !ids.has(product.productId)).length,
      updated: products.filter((product) => ids.has(product.productId)).length,
    };
    await this.audit.record({
      actorId: actor.id,
      action: "KNOWLEDGE_IMPORT",
      entityType: "KnowledgeSource",
      entityId: PRODUCT_SOURCE,
      after: result,
    });
    return { ...result, status: await this.status() };
  }

  /**
   * Starts embedding new or changed products with the configured model and removes passages for
   * deleted ones. Embedding runs in the background (external models are paced to the provider's
   * free-tier quota); progress and the outcome are reported by status().
   */
  async reindex(auth: AuthUser) {
    if (this.indexing)
      throw new ConflictException("Catalog indexing is already running");
    const { id, model, problem } = await this.embeddingModel();
    if (!model || problem)
      throw new BadRequestException(`Cannot index the catalog: ${problem}`);
    const actor = await this.users.syncUser(auth);
    const plan = await this.plan(
      id,
      model.capabilities.includes(TASK_PREFIX_CAPABILITY),
    );
    if (plan.orphaned.length)
      await this.prisma.knowledgeChunk.deleteMany({
        where: { id: { in: plan.orphaned } },
      });
    const interval = model.local ? 0 : this.externalBatchIntervalMs();
    const batchSize = this.batchSize(model);
    const batches = Math.ceil(plan.stale.length / batchSize);
    const run: IndexRun = {
      embeddingModel: id,
      pending: plan.stale.length,
      embedded: 0,
      removed: plan.orphaned.length,
      batches,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    this.run = run;
    const response = {
      ...run,
      started: plan.stale.length > 0,
      estimatedSeconds: Math.round(
        (Math.max(0, batches - 1) * interval) / 1000,
      ),
    };
    if (!plan.stale.length) {
      run.finishedAt = new Date().toISOString();
      await this.auditRun(actor.id, run);
      return response;
    }
    this.indexing = true;
    this.current = this.embedAll(
      actor.id,
      auth.roles,
      model,
      plan.stale,
      batchSize,
      interval,
      run,
    );
    return response;
  }

  private async embedAll(
    userId: string,
    roles: string[],
    model: AIModel,
    items: Awaited<ReturnType<KnowledgeService["plan"]>>["stale"],
    batchSize: number,
    interval: number,
    run: IndexRun,
  ) {
    try {
      for (let start = 0; start < items.length; start += batchSize) {
        if (start > 0 && interval) await sleep(interval);
        const batch = items.slice(start, start + batchSize);
        const vectors = await this.embed({
          requestId: `knowledge-index:${randomUUID()}`,
          userId,
          roles,
          conversationId: null,
          model,
          texts: batch.map((item) => item.input),
          rateLimitWaitMs: model.local ? 0 : RATE_LIMIT_BACKOFF_MS,
        });
        await this.prisma.$transaction(
          batch.map(
            (item, i) => this.prisma.$executeRaw`
              INSERT INTO "KnowledgeChunk" ("source", "sourceId", "title", "content", "contentHash", "embeddingModel", "embedding", "updatedAt")
              VALUES (${PRODUCT_SOURCE}, ${item.sourceId}, ${item.title}, ${item.text}, ${item.hash}, ${model.id}, ${vectorLiteral(vectors[i])}::vector, now())
              ON CONFLICT ("source", "sourceId", "embeddingModel") DO UPDATE SET
                "title" = EXCLUDED."title", "content" = EXCLUDED."content", "contentHash" = EXCLUDED."contentHash",
                "embedding" = EXCLUDED."embedding", "updatedAt" = now()`,
          ),
        );
        run.embedded += batch.length;
      }
      this.logger.log(
        `Indexed ${run.embedded} product(s) with ${model.id} (${run.removed} removed)`,
      );
    } catch (error) {
      // Saved batches stay indexed; re-running continues with the products still pending.
      run.error = (error as Error).message;
      this.logger.warn(
        `Catalog indexing stopped after ${run.embedded} of ${run.pending} product(s): ${run.error}`,
      );
    } finally {
      run.finishedAt = new Date().toISOString();
      this.indexing = false;
      await this.auditRun(userId, run).catch(() => undefined);
    }
  }

  private auditRun(actorId: string, run: IndexRun) {
    return this.audit.record({
      actorId,
      action: "KNOWLEDGE_REINDEX",
      entityType: "KnowledgeSource",
      entityId: PRODUCT_SOURCE,
      after: run,
    });
  }

  /**
   * Finds the catalog entries most similar to the query. Throws when the catalog is
   * unusable rather than answering product questions without it.
   */
  async retrieve(args: {
    userId: string;
    roles: string[];
    query: string;
    conversationId: string;
    requestId: string;
    acknowledgeSensitive?: boolean;
  }): Promise<ProductCitation[]> {
    const { id, model, problem } = await this.embeddingModel();
    if (!model || problem)
      throw new BadRequestException(
        `The product catalog is unavailable: ${problem}. Turn off "Product catalog" to chat without it.`,
      );
    const indexed = await this.prisma.knowledgeChunk.count({
      where: { source: PRODUCT_SOURCE, embeddingModel: id },
    });
    if (!indexed)
      throw new BadRequestException(
        'The product catalog has not been indexed yet. Ask an administrator to index it, or turn off "Product catalog".',
      );
    // The query itself leaves the installation when the embedding model is external.
    if (!model.local)
      await this.governance.checkSensitive(
        args.query,
        args.acknowledgeSensitive,
      );
    const [vector] = await this.embed({
      requestId: `${args.requestId}:retrieval`,
      userId: args.userId,
      roles: args.roles,
      conversationId: args.conversationId,
      model,
      texts: [
        queryInput(
          args.query,
          model.capabilities.includes(TASK_PREFIX_CAPABILITY),
        ),
      ],
    });
    const literal = vectorLiteral(vector);
    // Iterative scanning keeps returning HNSW candidates until LIMIT rows survive the model filter.
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`,
      this.prisma.$queryRaw<
        Array<{
          id: string;
          sourceId: string;
          title: string;
          content: string;
          score: number;
        }>
      >`
        SELECT "id", "sourceId", "title", "content", 1 - ("embedding" <=> ${literal}::vector) AS "score"
        FROM "KnowledgeChunk"
        WHERE "source" = ${PRODUCT_SOURCE} AND "embeddingModel" = ${id}
        ORDER BY "embedding" <=> ${literal}::vector
        LIMIT ${this.topK()}`,
    ]);
    return rows.map((row) => ({
      id: row.id,
      sourceId: `product:${row.sourceId}`,
      filename: row.title,
      page: null,
      content: row.content,
      kind: "product",
      score: Math.round(Number(row.score) * 1000) / 1000,
    }));
  }

  /** Every embedding call is admitted, metered and released exactly like a chat request. */
  private async embed(call: EmbeddingCall) {
    const input = call.texts.join("\n");
    await this.governance.reserve({
      requestId: call.requestId,
      userId: call.userId,
      modelId: call.model.id,
      roles: call.roles,
      external: !call.model.local,
      input,
      outputTokens: 0,
    });
    const started = Date.now();
    // Providers report no token counts for embeddings, so usage is ESTIMATED (or SYNTHETIC for the mock).
    const record = (status: RequestStatus, refused = false) =>
      this.usage.record({
        requestId: call.requestId,
        userId: call.userId,
        conversationId: call.conversationId,
        model: call.model,
        operation: UsageOperation.EMBEDDING,
        input,
        output: "",
        durationMs: Date.now() - started,
        status,
        // A rate-limited call was refused by the provider, so it processed no tokens.
        ...(refused
          ? { usage: { prompt_tokens: 0, completion_tokens: 0 } }
          : {}),
      });
    const isRateLimit = (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { vectors } = await this.gateway.embed(
            call.model.id,
            call.texts,
            EMBEDDING_DIMENSIONS,
            call.model.capabilities.includes(OUTPUT_DIMENSIONS_CAPABILITY),
          );
          await record(RequestStatus.COMPLETED);
          return vectors;
        } catch (error) {
          if (
            !isRateLimit(error) ||
            !call.rateLimitWaitMs ||
            attempt >= RATE_LIMIT_RETRIES
          )
            throw error;
          this.logger.warn(
            `${call.model.id} rate-limited; retrying in ${Math.round(call.rateLimitWaitMs / 1000)}s`,
          );
          await sleep(call.rateLimitWaitMs);
        }
      }
    } catch (error) {
      await record(RequestStatus.ERROR, isRateLimit(error)).catch(
        () => undefined,
      );
      throw error;
    } finally {
      await this.governance.release(call.requestId);
    }
  }

  /** Compares the catalog with stored passages; only new or changed text is re-embedded. */
  private async plan(modelId: string, taskPrefix: boolean) {
    const [products, chunks] = await Promise.all([
      this.prisma.product.findMany({ orderBy: { productId: "asc" } }),
      this.prisma.knowledgeChunk.findMany({
        where: { source: PRODUCT_SOURCE, embeddingModel: modelId },
        select: { id: true, sourceId: true, contentHash: true },
      }),
    ]);
    const stored = new Map(chunks.map((chunk) => [chunk.sourceId, chunk]));
    const items = products.map((product) => {
      const { title, text } = productPassage(product);
      const input = documentInput(title, text, taskPrefix);
      return {
        sourceId: String(product.productId),
        title,
        text,
        input,
        hash: contentHash(input),
      };
    });
    const current = new Set(items.map((item) => item.sourceId));
    return {
      total: items.length,
      stale: items.filter(
        (item) => stored.get(item.sourceId)?.contentHash !== item.hash,
      ),
      orphaned: chunks
        .filter((chunk) => !current.has(chunk.sourceId))
        .map((chunk) => chunk.id),
    };
  }
}
