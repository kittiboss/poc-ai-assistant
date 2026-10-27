// Knowledge store. Every tenant operation runs in withTenant(), which sets the row-level security
// context for its transaction, and every query also filters by tenant_id explicitly.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { chunkSections, documentInput } from "./chunk.mjs";
import { Fault } from "./errors.mjs";
import {
  EMBEDDING_DIMENSIONS,
  defaultSettings,
  effectiveSettings,
  reindexNeeded,
  settingsInput,
} from "./settings.mjs";

const MB = 1024 * 1024;
export const PAUSE_REASONS = [
  "CREDIT_EXHAUSTED",
  "POLICY",
  "DAILY_LIMIT",
  "RATE_LIMITED",
  "MODEL_UNAVAILABLE",
  "ERROR",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Fault(404, "not_found", "Document not found");
const quota = (message) => new Fault(409, "quota_exceeded", message);

/** Applies the schema as the owner and sets the application role's password. */
export async function migrate(ownerUrl, appPassword) {
  if (!appPassword || appPassword.length < 16) throw new Error("RAG_APP_DB_PASSWORD must be at least 16 characters");
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    await owner.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
    await owner.query(`ALTER ROLE rag_app PASSWORD ${owner.escapeLiteral(appPassword)}`);
  } finally {
    await owner.end();
  }
}

/** The same database, signed in as the row-level-security-bound application role. */
export function appUrl(ownerUrl, appPassword) {
  const url = new URL(ownerUrl);
  url.username = "rag_app";
  url.password = encodeURIComponent(appPassword);
  return url.toString();
}

const settingsOf = (row) => ({
  embeddingModel: row.embedding_model,
  topK: row.top_k,
  minScore: Number(row.min_score),
  chunkSize: row.chunk_size,
  chunkOverlap: row.chunk_overlap,
});
const active = (row) => (row.active_version ? { version: row.active_version, model: row.active_model } : null);

function requester(value) {
  if (!value || typeof value.userId !== "string" || !Array.isArray(value.roles))
    throw new Fault(400, "invalid_request", "requestedBy {userId, roles} is required");
  return { userId: value.userId.slice(0, 100), roles: value.roles.filter((role) => typeof role === "string").slice(0, 10) };
}

export class KnowledgeStore {
  constructor(pool) {
    this.pool = pool;
  }

  async withTenant(tenant, fn, { lock = false } = {}) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      // Serializes a tenant's writes so limits cannot be exceeded by concurrent uploads.
      if (lock) await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rag:${tenant}`]);
      const value = await fn(db);
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async settingsRow(db, ctx) {
    const {
      rows: [row],
    } = await db.query("SELECT * FROM rag.settings WHERE tenant_id=$1", [ctx.tenant]);
    if (row) return row;
    const d = defaultSettings(ctx.limits);
    const {
      rows: [created],
    } = await db.query(
      `INSERT INTO rag.settings(tenant_id,embedding_model,top_k,min_score,chunk_size,chunk_overlap)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id RETURNING *`,
      [ctx.tenant, d.embeddingModel, d.topK, d.minScore, d.chunkSize, d.chunkOverlap],
    );
    return created;
  }

  /** Marks finished documents READY and switches search to the new version once it is complete. */
  async settle(db, tenant) {
    const {
      rows: [s],
    } = await db.query("SELECT * FROM rag.settings WHERE tenant_id=$1", [tenant]);
    if (!s) return;
    await db.query(
      `UPDATE rag.documents d SET status='READY', reason=NULL, updated_at=now()
       WHERE d.tenant_id=$1 AND d.status<>'READY' AND NOT EXISTS (
         SELECT 1 FROM rag.chunks c WHERE c.tenant_id=d.tenant_id AND c.document_id=d.id AND c.version=$2 AND c.embedding IS NULL)`,
      [tenant, s.version],
    );
    const {
      rows: [{ pending }],
    } = await db.query(
      "SELECT count(*)::int AS pending FROM rag.chunks WHERE tenant_id=$1 AND version=$2 AND embedding IS NULL",
      [tenant, s.version],
    );
    if (pending === 0 && s.active_version !== s.version) {
      await db.query(
        "UPDATE rag.settings SET active_version=version, active_model=embedding_model, updated_at=now() WHERE tenant_id=$1",
        [tenant],
      );
      await db.query("DELETE FROM rag.chunks WHERE tenant_id=$1 AND version<>$2", [tenant, s.version]);
    }
  }

  async usage(db, tenant, version) {
    const {
      rows: [row],
    } = await db.query(
      `SELECT
        (SELECT count(*) FROM rag.documents WHERE tenant_id=$1)::int AS documents,
        (SELECT COALESCE(sum(text_bytes),0) FROM rag.documents WHERE tenant_id=$1)::bigint AS text_bytes,
        (SELECT count(*) FROM rag.chunks WHERE tenant_id=$1 AND version=$2)::int AS chunks,
        (SELECT count(*) FROM rag.chunks c JOIN rag.documents d ON d.tenant_id=c.tenant_id AND d.id=c.document_id
          WHERE c.tenant_id=$1 AND c.version=$2 AND c.embedding IS NULL AND d.status='INDEXING')::int AS pending,
        (SELECT count(*) FROM rag.documents WHERE tenant_id=$1 AND status='PAUSED')::int AS paused,
        (SELECT count(*) FROM rag.documents WHERE tenant_id=$1 AND sensitive_findings>0)::int AS sensitive`,
      [tenant, version],
    );
    return {
      documents: row.documents,
      textBytes: Number(row.text_bytes),
      chunks: row.chunks,
      pendingChunks: row.pending,
      pausedDocuments: row.paused,
      sensitiveDocuments: row.sensitive,
    };
  }

  async config(ctx) {
    return this.withTenant(ctx.tenant, async (db) => {
      const s = await this.settingsRow(db, ctx);
      const settings = settingsOf(s);
      const effective = effectiveSettings(settings, ctx.limits, active(s));
      return {
        tenant: ctx.tenant,
        limits: ctx.limits,
        embeddingBatch: ctx.embeddingBatch ?? null,
        settings,
        effective: { topK: effective.topK, minScore: effective.minScore },
        problem: effective.problem,
        active: active(s),
        target: { version: s.version, model: s.embedding_model },
        usage: await this.usage(db, ctx.tenant, s.version),
      };
    });
  }

  async updateSettings(ctx, body) {
    const by = requester(body?.requestedBy);
    const { requestedBy: _, ...changes } = body;
    return this.withTenant(
      ctx.tenant,
      async (db) => {
        const s = await this.settingsRow(db, ctx);
        const current = settingsOf(s);
        const next = settingsInput(changes, current, ctx.limits);
        if (!reindexNeeded(current, next)) {
          await db.query("UPDATE rag.settings SET top_k=$2, min_score=$3, updated_at=now() WHERE tenant_id=$1", [
            ctx.tenant,
            next.topK,
            next.minScore,
          ]);
          return { reindex: false };
        }
        // Re-chunk every stored document for the new version before touching anything.
        const { rows: docs } = await db.query("SELECT id, filename, sections FROM rag.documents WHERE tenant_id=$1", [
          ctx.tenant,
        ]);
        const planned = docs.map((doc) => ({ id: doc.id, chunks: chunkSections(doc, next) }));
        const total = planned.reduce((sum, doc) => sum + doc.chunks.length, 0);
        const largest = Math.max(0, ...planned.map((doc) => doc.chunks.length));
        if (largest > ctx.limits.maxChunksPerDocument)
          throw quota(`These settings would split a document into ${largest} chunks; your limit is ${ctx.limits.maxChunksPerDocument}`);
        if (total > ctx.limits.maxTotalChunks)
          throw quota(`These settings would create ${total} chunks; your limit is ${ctx.limits.maxTotalChunks}`);
        const version = s.version + 1;
        await db.query(
          `UPDATE rag.settings SET embedding_model=$2, top_k=$3, min_score=$4, chunk_size=$5, chunk_overlap=$6,
           version=$7, updated_at=now() WHERE tenant_id=$1`,
          [ctx.tenant, next.embeddingModel, next.topK, next.minScore, next.chunkSize, next.chunkOverlap, version],
        );
        // Search keeps the active version; anything else (an unfinished earlier change) goes.
        await db.query("DELETE FROM rag.chunks WHERE tenant_id=$1 AND version IS DISTINCT FROM $2::int", [
          ctx.tenant,
          s.active_version,
        ]);
        for (const doc of planned) await this.insertChunks(db, ctx.tenant, doc.id, version, next.embeddingModel, doc.chunks);
        await db.query(
          "UPDATE rag.documents SET status='INDEXING', reason=NULL, requested_by=$2, updated_at=now() WHERE tenant_id=$1",
          [ctx.tenant, by],
        );
        await this.settle(db, ctx.tenant);
        return { reindex: true, version, chunks: total };
      },
      { lock: true },
    );
  }

  async insertChunks(db, tenant, documentId, version, model, chunks) {
    await db.query(
      `INSERT INTO rag.chunks(tenant_id, document_id, version, ordinal, page, title, content, embedding_model)
       SELECT $1, $2, $3, x.ordinal, x.page, x.title, x.content, $4
       FROM unnest($5::int[], $6::int[], $7::text[], $8::text[]) AS x(ordinal, page, title, content)`,
      [
        tenant,
        documentId,
        version,
        model,
        chunks.map((c) => c.ordinal),
        chunks.map((c) => c.page),
        chunks.map((c) => c.title),
        chunks.map((c) => c.content),
      ],
    );
  }

  async documents(ctx) {
    return this.withTenant(ctx.tenant, async (db) => {
      const s = await this.settingsRow(db, ctx);
      const { rows } = await db.query(
        `SELECT d.id, d.filename, d.type, d.file_bytes, d.text_bytes, jsonb_array_length(d.sections) AS sections,
          d.sensitive_findings, d.enabled, d.status, d.reason, d.created_at, d.updated_at,
          (SELECT count(*) FROM rag.chunks c WHERE c.tenant_id=d.tenant_id AND c.document_id=d.id AND c.version=$2)::int AS chunks,
          (SELECT count(*) FROM rag.chunks c WHERE c.tenant_id=d.tenant_id AND c.document_id=d.id AND c.version=$2
            AND c.embedding IS NOT NULL)::int AS embedded
         FROM rag.documents d WHERE d.tenant_id=$1 ORDER BY d.created_at DESC`,
        [ctx.tenant, s.version],
      );
      return rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        type: row.type,
        fileBytes: row.file_bytes,
        textBytes: row.text_bytes,
        sections: row.sections,
        sensitiveFindings: row.sensitive_findings,
        enabled: row.enabled,
        status: row.status,
        reason: row.reason,
        chunks: row.chunks,
        embedded: row.embedded,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    });
  }

  async addDocument(ctx, body) {
    const limits = ctx.limits;
    if (!limits.enabled) throw new Fault(403, "knowledge_disabled", "The knowledge base is turned off for your organization");
    const doc = documentInput(body);
    const by = requester(body.requestedBy);
    if (!limits.allowedTypes.includes(doc.type))
      throw new Fault(400, "type_not_allowed", `Your plan allows these file types: ${limits.allowedTypes.join(", ")}`);
    if (doc.fileBytes > limits.maxFileMb * MB) throw quota(`Files can be up to ${limits.maxFileMb} MB on your plan`);
    return this.withTenant(
      ctx.tenant,
      async (db) => {
        const s = await this.settingsRow(db, ctx);
        const settings = settingsOf(s);
        if (!limits.embeddingModels.includes(settings.embeddingModel))
          throw new Fault(409, "model_not_allowed", effectiveSettings(settings, limits, null).problem);
        const chunks = chunkSections(doc, settings);
        if (chunks.length > limits.maxChunksPerDocument)
          throw quota(`This document makes ${chunks.length} chunks; your limit is ${limits.maxChunksPerDocument} per document`);
        const used = await this.usage(db, ctx.tenant, s.version);
        if (used.documents + 1 > limits.maxDocuments) throw quota(`Your plan allows ${limits.maxDocuments} documents`);
        if (used.textBytes + doc.textBytes > limits.maxTextMb * MB)
          throw quota(`Your plan allows ${limits.maxTextMb} MB of document text`);
        if (used.chunks + chunks.length > limits.maxTotalChunks)
          throw quota(`Your plan allows ${limits.maxTotalChunks} chunks in total`);
        const {
          rows: [row],
        } = await db.query(
          `INSERT INTO rag.documents(tenant_id, filename, type, file_bytes, text_bytes, sections, sensitive_findings, requested_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
          [ctx.tenant, doc.filename, doc.type, doc.fileBytes, doc.textBytes, JSON.stringify(doc.sections), doc.sensitiveFindings, by],
        );
        await this.insertChunks(db, ctx.tenant, row.id, s.version, settings.embeddingModel, chunks);
        return {
          id: row.id,
          filename: doc.filename,
          type: doc.type,
          sections: doc.sections.length,
          chunks: chunks.length,
          textBytes: doc.textBytes,
          status: "INDEXING",
          createdAt: row.created_at,
        };
      },
      { lock: true },
    );
  }

  async setEnabled(ctx, id, enabled) {
    if (!uuid.test(id ?? "")) throw notFound();
    if (typeof enabled !== "boolean") throw new Fault(400, "invalid_request", "enabled must be true or false");
    return this.withTenant(ctx.tenant, async (db) => {
      const result = await db.query(
        "UPDATE rag.documents SET enabled=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id, enabled",
        [ctx.tenant, id, enabled],
      );
      if (!result.rowCount) throw notFound();
      return result.rows[0];
    });
  }

  async deleteDocument(ctx, id) {
    if (!uuid.test(id ?? "")) throw notFound();
    return this.withTenant(
      ctx.tenant,
      async (db) => {
        const result = await db.query("DELETE FROM rag.documents WHERE tenant_id=$1 AND id=$2 RETURNING id", [ctx.tenant, id]);
        if (!result.rowCount) throw notFound();
        await this.settle(db, ctx.tenant);
        return { id, deleted: true };
      },
      { lock: true },
    );
  }

  /** Stops indexing for a reason the tenant API detected (credit, policy, daily limit…). */
  async pause(ctx, reason) {
    if (!PAUSE_REASONS.includes(reason)) throw new Fault(400, "invalid_request", "Unknown pause reason");
    return this.withTenant(ctx.tenant, async (db) => {
      const result = await db.query(
        "UPDATE rag.documents SET status='PAUSED', reason=$2, updated_at=now() WHERE tenant_id=$1 AND status='INDEXING'",
        [ctx.tenant, reason],
      );
      return { paused: result.rowCount };
    });
  }

  /** Resumes paused documents: one (id), or all paused for the given reasons. */
  async resume(ctx, { id, reasons } = {}) {
    if (id !== undefined && !uuid.test(id)) throw notFound();
    if (reasons !== undefined && (!Array.isArray(reasons) || reasons.some((r) => !PAUSE_REASONS.includes(r))))
      throw new Fault(400, "invalid_request", "Unknown pause reason");
    return this.withTenant(
      ctx.tenant,
      async (db) => {
        if (id && !(await db.query("SELECT 1 FROM rag.documents WHERE tenant_id=$1 AND id=$2", [ctx.tenant, id])).rowCount)
          throw notFound();
        const result = await db.query(
          `UPDATE rag.documents SET status='INDEXING', reason=NULL, updated_at=now()
           WHERE tenant_id=$1 AND status='PAUSED' AND ($2::uuid IS NULL OR id=$2) AND ($3::text[] IS NULL OR reason = ANY($3))`,
          [ctx.tenant, id ?? null, reasons ?? null],
        );
        await this.settle(db, ctx.tenant);
        return { resumed: result.rowCount };
      },
      { lock: true },
    );
  }

  /** The next passages to embed, all from one document so one requester's quotas apply. */
  async next(ctx, { maxItems = 32, maxBytes = 200_000 } = {}) {
    const items = Math.min(100, Math.max(1, Number(maxItems) || 32));
    const bytes = Math.min(250_000, Math.max(1000, Number(maxBytes) || 200_000));
    return this.withTenant(ctx.tenant, async (db) => {
      const s = await this.settingsRow(db, ctx);
      const target = { version: s.version, model: s.embedding_model };
      const { pendingChunks } = await this.usage(db, ctx.tenant, s.version);
      if (!ctx.limits.enabled || !ctx.limits.embeddingModels.includes(s.embedding_model))
        return {
          ...target,
          items: [],
          remaining: pendingChunks,
          problem: effectiveSettings(settingsOf(s), ctx.limits, null).problem,
        };
      const {
        rows: [doc],
      } = await db.query(
        `SELECT d.id, d.requested_by FROM rag.documents d WHERE d.tenant_id=$1 AND d.status='INDEXING' AND EXISTS (
           SELECT 1 FROM rag.chunks c WHERE c.tenant_id=d.tenant_id AND c.document_id=d.id AND c.version=$2 AND c.embedding IS NULL)
         ORDER BY d.created_at LIMIT 1`,
        [ctx.tenant, s.version],
      );
      if (!doc) return { ...target, items: [], remaining: pendingChunks };
      const { rows } = await db.query(
        `SELECT id, title, content FROM rag.chunks WHERE tenant_id=$1 AND document_id=$2 AND version=$3 AND embedding IS NULL
         ORDER BY ordinal LIMIT $4`,
        [ctx.tenant, doc.id, s.version, items],
      );
      const batch = [];
      let size = 0;
      for (const row of rows) {
        size += Buffer.byteLength(row.title) + Buffer.byteLength(row.content);
        if (batch.length && size > bytes) break;
        batch.push({ chunkId: row.id, title: row.title, text: row.content });
      }
      return { ...target, documentId: doc.id, requestedBy: doc.requested_by, items: batch, remaining: pendingChunks };
    });
  }

  async storeVectors(ctx, body) {
    const { version, model, items } = body ?? {};
    if (!Array.isArray(items) || !items.length || items.length > 100)
      throw new Fault(400, "invalid_request", "1 to 100 vectors are required");
    for (const item of items)
      if (
        !uuid.test(item?.chunkId ?? "") ||
        !Array.isArray(item.vector) ||
        item.vector.length !== EMBEDDING_DIMENSIONS ||
        !item.vector.every(Number.isFinite)
      )
        throw new Fault(400, "invalid_request", `Each item needs a chunkId and ${EMBEDDING_DIMENSIONS} finite numbers`);
    return this.withTenant(
      ctx.tenant,
      async (db) => {
        const s = await this.settingsRow(db, ctx);
        // Settings changed while these were being embedded: the vectors belong to an old version.
        if (s.version !== version || s.embedding_model !== model)
          throw new Fault(409, "stale_version", "The index version changed; fetch the next batch again");
        const result = await db.query(
          `UPDATE rag.chunks c SET embedding = v.embedding::vector
           FROM unnest($2::uuid[], $3::text[]) AS v(id, embedding)
           WHERE c.tenant_id=$1 AND c.id=v.id AND c.version=$4 AND c.embedding IS NULL`,
          [ctx.tenant, items.map((i) => i.chunkId), items.map((i) => `[${i.vector.join(",")}]`), version],
        );
        await this.settle(db, ctx.tenant);
        const { pendingChunks } = await this.usage(db, ctx.tenant, version);
        return { stored: result.rowCount, remaining: pendingChunks };
      },
      { lock: true },
    );
  }

  async search(ctx, body) {
    const { model, vector } = body ?? {};
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))
      throw new Fault(400, "invalid_request", `vector must have ${EMBEDDING_DIMENSIONS} finite numbers`);
    return this.withTenant(ctx.tenant, async (db) => {
      const s = await this.settingsRow(db, ctx);
      const effective = effectiveSettings(settingsOf(s), ctx.limits, active(s));
      if (effective.problem) throw new Fault(409, "knowledge_unavailable", effective.problem);
      if (!s.active_version) return { model: null, version: null, topK: effective.topK, citations: [] };
      if (model !== s.active_model)
        throw new Fault(409, "model_mismatch", `The index uses ${s.active_model}; embed the query with it`);
      // Iterative scan keeps reading the HNSW graph until enough rows pass the tenant filter.
      await db.query("SET LOCAL hnsw.iterative_scan = strict_order");
      await db.query("SET LOCAL hnsw.ef_search = 100");
      const { rows } = await db.query(
        `SELECT c.id, c.document_id, d.filename, c.page, c.title, c.content, 1 - (c.embedding <=> $2::vector) AS score
         FROM rag.chunks c JOIN rag.documents d ON d.tenant_id=c.tenant_id AND d.id=c.document_id
         WHERE c.tenant_id=$1 AND c.version=$3 AND c.embedding_model=$4 AND c.embedding IS NOT NULL AND d.enabled
         ORDER BY c.embedding <=> $2::vector LIMIT $5`,
        [ctx.tenant, `[${vector.join(",")}]`, s.active_version, s.active_model, effective.topK],
      );
      return {
        model: s.active_model,
        version: s.active_version,
        topK: effective.topK,
        minScore: effective.minScore,
        citations: rows
          .map((row) => ({
            chunkId: row.id,
            documentId: row.document_id,
            filename: row.filename,
            title: row.title,
            page: row.page,
            content: row.content,
            score: Math.round(Number(row.score) * 1000) / 1000,
          }))
          .filter((citation) => citation.score >= effective.minScore),
      };
    });
  }

  /** Vendor console totals. Runs through a SECURITY DEFINER function returning counts only. */
  async tenantUsage() {
    const { rows } = await this.pool.query("SELECT * FROM rag.tenant_usage()");
    return {
      tenants: rows.map((row) => ({
        tenant: row.tenant,
        documents: Number(row.documents),
        textBytes: Number(row.text_bytes),
        chunks: Number(row.chunks),
      })),
    };
  }

  /** Deletes all knowledge of one tenant (tenant:down --remove). */
  async purge(tenant) {
    return this.withTenant(
      tenant,
      async (db) => {
        const documents = await db.query("DELETE FROM rag.documents WHERE tenant_id=$1", [tenant]);
        await db.query("DELETE FROM rag.settings WHERE tenant_id=$1", [tenant]);
        return { tenant, documents: documents.rowCount };
      },
      { lock: true },
    );
  }
}
