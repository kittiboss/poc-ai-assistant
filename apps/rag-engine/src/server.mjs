// Central RAG engine. Tenant deployments call it with their platform credential; the tenant id
// always comes from that credential (via vendor-control), never from the request. It stores,
// chunks and searches knowledge; tenant APIs embed text through their own metered gateway path.
import express from "express";
import pg from "pg";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Fault } from "./errors.mjs";
import { KnowledgeStore, appUrl, migrate } from "./store.mjs";
import { Tenants } from "./tenants.mjs";

const same = (a, b) =>
  Boolean(a && b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)));
const bearer = (req) => req.get("authorization")?.replace(/^Bearer /, "") ?? "";
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,19}$/.test(id ?? "");

export function createApp(store, { tenants, adminKey }) {
  if (!adminKey || adminKey.length < 32) throw new Error("RAG_ADMIN_KEY must be at least 32 characters");
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    next();
  });
  // Extracted text of one document (up to 1.5 MB from the tenant API) plus JSON overhead.
  app.use(express.json({ limit: "2mb" }));
  app.get("/health/readiness", async (_req, res) => {
    await store.pool.query("SELECT 1");
    res.json({ status: "ok" });
  });

  // Vendor-only: totals for the console and purge on tenant removal. Reached through vendor-control.
  app.use("/admin", (req, res, next) =>
    same(bearer(req), adminKey) ? next() : res.status(401).json({ error: { message: "Admin authentication required" } }),
  );
  app.get("/admin/usage", async (_req, res) => res.json(await store.tenantUsage()));
  app.delete("/admin/tenants/:id", async (req, res) => {
    if (!validId(req.params.id)) throw new Fault(400, "invalid_request", "Invalid tenant ID");
    res.json(await store.purge(req.params.id));
  });

  app.use("/v1", async (req, _res, next) => {
    req.ctx = await tenants.resolve(bearer(req));
    next();
  });
  app.get("/v1/config", async (req, res) => res.json(await store.config(req.ctx)));
  app.patch("/v1/settings", async (req, res) => res.json(await store.updateSettings(req.ctx, req.body)));
  app.get("/v1/documents", async (req, res) => res.json(await store.documents(req.ctx)));
  app.post("/v1/documents", async (req, res) => res.status(201).json(await store.addDocument(req.ctx, req.body)));
  app.patch("/v1/documents/:id", async (req, res) =>
    res.json(await store.setEnabled(req.ctx, req.params.id, req.body?.enabled)),
  );
  app.delete("/v1/documents/:id", async (req, res) => res.json(await store.deleteDocument(req.ctx, req.params.id)));
  app.post("/v1/documents/:id/retry", async (req, res) => res.json(await store.resume(req.ctx, { id: req.params.id })));
  app.post("/v1/index/pause", async (req, res) => res.json(await store.pause(req.ctx, req.body?.reason)));
  app.post("/v1/index/resume", async (req, res) => res.json(await store.resume(req.ctx, { reasons: req.body?.reasons })));
  app.get("/v1/index/next", async (req, res) =>
    res.json(await store.next(req.ctx, { maxItems: req.query.maxItems, maxBytes: req.query.maxBytes })),
  );
  app.post("/v1/index/vectors", async (req, res) => res.json(await store.storeVectors(req.ctx, req.body)));
  app.post("/v1/search", async (req, res) => res.json(await store.search(req.ctx, req.body)));

  app.use((_req, res) => res.status(404).json({ error: { message: "Not found" } }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status =
      error instanceof Fault
        ? error.status
        : error.type === "entity.parse.failed"
          ? 400
          : error.type === "entity.too.large"
            ? 413
            : 503;
    // Never log document text, queries or credentials; the error code is enough to investigate.
    if (status === 503) console.error("RAG engine operation failed:", error.code ?? error.name);
    res.status(status).json({
      error: {
        type: error instanceof Fault ? error.type : status === 413 ? "too_large" : "service_unavailable",
        message:
          error instanceof Fault
            ? error.message
            : status === 413
              ? "Document is too large"
              : status === 400
                ? "Invalid JSON"
                : "Knowledge service unavailable",
      },
    });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ownerUrl = process.env.DATABASE_URL;
  const appPassword = process.env.RAG_APP_DB_PASSWORD;
  await migrate(ownerUrl, appPassword);
  // From here on the engine only uses the role that row-level security applies to.
  const pool = new pg.Pool({ connectionString: appUrl(ownerUrl, appPassword), max: 5 });
  const app = createApp(new KnowledgeStore(pool), {
    tenants: new Tenants({ vendorUrl: process.env.VENDOR_CONTROL_URL || "http://vendor-control:4050" }),
    adminKey: process.env.RAG_ADMIN_KEY,
  });
  const server = app.listen(Number(process.env.PORT || 4060), "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
