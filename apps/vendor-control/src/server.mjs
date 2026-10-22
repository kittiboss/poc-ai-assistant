import express from "express";
import pg from "pg";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Fault, Store, defaultConfig, validId } from "./store.mjs";
import { validateRequest } from "./money.mjs";

const same = (a, b) =>
  Boolean(
    a &&
      b &&
      Buffer.byteLength(a) === Buffer.byteLength(b) &&
      timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  );
const bearer = (req) => req.get("authorization")?.replace(/^Bearer /, "") ?? "";
const reference = (body, prefix) => {
  if (
    typeof body?.reference !== "string" ||
    !/^[a-zA-Z0-9:_-]{1,100}$/.test(body.reference)
  )
    throw new Fault(
      400,
      "invalid_request",
      "A unique idempotency reference is required",
    );
  return `${prefix}:${body.reference}`;
};

export function createApp(
  store,
  { adminKey, upstreamUrl, fetchUpstream = fetch },
) {
  if (!adminKey || adminKey.length < 32)
    throw new Error("VENDOR_ADMIN_KEY must be at least 32 characters");
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    // No CORS. Prevent cookie/basic-authenticated cross-origin mutations (localhost POC).
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") &&
      req.get("origin") !== `${req.protocol}://${req.get("host")}`
    )
      return res
        .status(403)
        .json({ error: { message: "Cross-origin mutation denied" } });
    next();
  });
  app.use(express.json({ limit: "512kb" }));
  app.get("/health/readiness", async (_req, res) => {
    await store.pool.query("SELECT 1");
    res.json({ status: "ok", simulation: true });
  });

  // Dedicated localhost-only vendor credential; never supplied to tenant containers.
  const admin = (req, res, next) => {
    const auth = req.get("authorization") ?? "";
    const decoded = auth.startsWith("Basic ")
      ? Buffer.from(auth.slice(6), "base64").toString()
      : "";
    if (same(bearer(req), adminKey) || same(decoded, `vendor:${adminKey}`))
      return next();
    res
      .set("WWW-Authenticate", 'Basic realm="Vendor POC console"')
      .status(401)
      .json({ error: { message: "Vendor authentication required" } });
  };
  app.use("/admin", admin);
  app.get("/admin/tenants", async (_req, res) =>
    res.json(await store.tenants()),
  );
  app.post("/admin/tenants", async (req, res) => {
    const { id, name, webPort = 3400 } = req.body;
    if (
      !validId(id) ||
      !Number.isInteger(webPort) ||
      webPort < 1024 ||
      webPort > 65000
    )
      throw new Fault(400, "invalid_request", "Invalid ID or web port");
    const config = defaultConfig(id, name, webPort);
    res
      .status(201)
      .json(await store.register(config, undefined, config.initialCreditUsd));
  });
  app.post("/admin/register", async (req, res) =>
    res.json(
      await store.register(
        req.body.config,
        req.body.key,
        req.body.openingCredit ?? 0,
      ),
    ),
  );
  app.get("/admin/tenants/:id/config", async (req, res) => {
    const {
      rows: [tenant],
    } = await store.pool.query(
      "SELECT config FROM vendor.tenants WHERE id=$1",
      [req.params.id],
    );
    if (!tenant) throw new Fault(404, "not_found", "Unknown tenant");
    res.json(tenant.config);
  });
  app.get("/admin/tenants/:id/billing", async (req, res) => {
    const {
      rows: [tenant],
    } = await store.pool.query(
      "SELECT id,config FROM vendor.tenants WHERE id=$1",
      [req.params.id],
    );
    if (!tenant) throw new Fault(404, "not_found", "Unknown tenant");
    res.json(await store.billing(tenant));
  });
  app.post("/admin/tenants/:id/credits", async (req, res) =>
    res.json(
      await store.grant(
        req.params.id,
        req.body.amount,
        reference(req.body, "vendor"),
      ),
    ),
  );
  app.patch("/admin/tenants/:id", async (req, res) => {
    if (typeof req.body.enabled !== "boolean")
      throw new Fault(400, "invalid_request", "enabled must be boolean");
    const result = await store.pool.query(
      "UPDATE vendor.tenants SET enabled=$2 WHERE id=$1 RETURNING id,enabled",
      [req.params.id, req.body.enabled],
    );
    if (!result.rowCount) throw new Fault(404, "not_found", "Unknown tenant");
    res.json(result.rows[0]);
  });
  app.get("/admin/prices", async (_req, res) => res.json(await store.prices()));
  app.get("/admin/prices/history", async (_req, res) =>
    res.json(await store.prices(false, true)),
  );
  app.post("/admin/prices", async (req, res) =>
    res.status(201).json(await store.addPrice(req.body)),
  );
  // A crash can leave a reservation pending. Never silently release possibly consumed credit.
  app.post("/admin/tenants/:id/reconcile", async (req, res) => {
    const result = await store.tx(async (db) => {
      await db.query("SELECT id FROM vendor.tenants WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      const { rows } = await db.query(
        "UPDATE vendor.requests SET state='ESTIMATED',charge=reserved,completed_at=now() WHERE tenant=$1 AND state='PENDING' AND created_at < now()-interval '5 minutes' RETURNING request_id,reserved",
        [req.params.id],
      );
      for (const row of rows) {
        await db.query(
          "UPDATE vendor.tenants SET balance=balance-$2 WHERE id=$1",
          [req.params.id, row.reserved],
        );
        await db.query(
          "INSERT INTO vendor.ledger(tenant,reference,kind,amount) VALUES($1,$2,'ESTIMATED_DEBIT',$3)",
          [req.params.id, `request:${row.request_id}`, `-${row.reserved}`],
        );
      }
      return { settled: rows.length, simulation: true };
    });
    res.json(result);
  });
  app.use(
    "/console",
    admin,
    express.static(fileURLToPath(new URL("../public", import.meta.url))),
  );
  app.get("/", (_req, res) => res.redirect("/console/"));

  app.use(async (req, _res, next) => {
    req.tenant = await store.authenticate(bearer(req));
    next();
  });
  app.get("/v1/models", (req, res) =>
    res.json({
      data: req.tenant.config.models.map((id) => ({ id, object: "model" })),
    }),
  );
  app.get("/key/info", async (req, res) => {
    const credit = await store.balance(req.tenant.id);
    res.json({
      info: {
        models: req.tenant.config.models,
        max_budget: credit.limit,
        spend: credit.spent,
        credit,
      },
    });
  });
  app.get("/customer/billing", async (req, res) =>
    res.json(await store.billing(req.tenant)),
  );
  app.post("/customer/topups", async (req, res) =>
    res
      .status(201)
      .json(
        await store.grant(
          req.tenant.id,
          req.body.amount,
          reference(req.body, "customer"),
        ),
      ),
  );

  const inference = (embedding) => async (req, res) => {
    let bounds;
    try {
      bounds = validateRequest(req.body, embedding);
    } catch (error) {
      throw new Fault(400, "invalid_request", error.message);
    }
    const requestId = req.get("x-request-id");
    const reservation = await store.reserve(
      req.tenant,
      requestId,
      req.body,
      bounds,
      embedding ? "EMBEDDING" : "CHAT",
    );
    let finalized = false;
    let usage;
    let hasOutput = false;
    // Continue metering if the browser disconnects. Upstream has a hard deadline; this prevents free cancel/retry.
    try {
      const upstream = await fetchUpstream(
        `${upstreamUrl}/v1/${embedding ? "embeddings" : "chat/completions"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer(req)}`,
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            ...bounds.upstream,
            metadata: { request_id: requestId, tenant_id: req.tenant.id },
          }),
          signal: AbortSignal.timeout(120000),
        },
      );
      if (!upstream.ok) {
        await store.settle(req.tenant, requestId, reservation, undefined, true);
        finalized = true;
        const status = [400, 401, 402, 403, 404, 422, 429].includes(
          upstream.status,
        )
          ? upstream.status
          : 502;
        return res
          .status(status)
          .json({
            error: {
              type: status === 429 ? "rate_limited" : "upstream_rejected",
              message:
                "AI gateway rejected the request. No test credit deducted.",
            },
          });
      }
      if (embedding) {
        const body = await upstream.json();
        if (!Array.isArray(body.data))
          throw new Error("Invalid embedding response");
        usage = body.usage;
        const billing = await store.settle(
          req.tenant,
          requestId,
          reservation,
          usage,
        );
        finalized = true;
        return res.json({
          data: body.data,
          model: req.body.model,
          usage,
          billing,
        });
      }
      res
        .status(200)
        .set({
          "Content-Type": "text/event-stream",
          "X-Accel-Buffering": "no",
        });
      res.flushHeaders();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = false;
      for await (const chunk of upstream.body) {
        buffer += decoder
          .decode(chunk, { stream: true })
          .replaceAll("\r\n", "\n");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.usage) usage = event.usage;
          if (event.error) {
            streamError = true;
            continue;
          }
          if (event.choices?.some((c) => c.delta?.content)) hasOutput = true;
          // Never forward upstream error detail, credential hints, internal prices or provider metadata.
          if (!res.destroyed)
            res.write(
              `data: ${JSON.stringify({ choices: event.choices, usage: event.usage })}\n\n`,
            );
        }
      }
      const billing = await store.settle(
        req.tenant,
        requestId,
        reservation,
        usage,
        streamError && !hasOutput,
      );
      finalized = true;
      if (!res.destroyed) {
        if (streamError)
          res.write(
            `data: ${JSON.stringify({ error: { code: 502, message: "Provider stream failed" } })}\n\n`,
          );
        res.write(
          `data: ${JSON.stringify({ billing, usage })}\n\ndata: [DONE]\n\n`,
        );
        res.end();
      }
    } catch (error) {
      // A network error does not prove the provider did no work. Charge the conservative reservation
      // and label it ESTIMATED; an operator can issue an auditable compensating grant if needed.
      if (!finalized)
        await store.settle(req.tenant, requestId, reservation, usage);
      if (res.headersSent) {
        if (!res.destroyed)
          res.end(
            'data: {"error":{"code":502,"message":"Gateway interrupted; see billing history"}}\n\ndata: [DONE]\n\n',
          );
      } else
        throw new Fault(
          502,
          "upstream_unavailable",
          "Gateway interrupted; see estimated charge in billing history",
        );
    }
  };
  app.post("/v1/chat/completions", inference(false));
  app.post("/v1/embeddings", inference(true));
  app.use((_req, res) =>
    res.status(404).json({ error: { message: "Not found" } }),
  );
  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      error instanceof Fault
        ? error.status
        : error.type === "entity.parse.failed"
          ? 400
          : 503;
    if (status === 503)
      console.error(
        "Vendor service operation failed:",
        error.code ?? error.name,
      ); // No bodies/credentials.
    res
      .status(status)
      .json({
        error: {
          type: error instanceof Fault ? error.type : "service_unavailable",
          message:
            error instanceof Fault
              ? error.message
              : "Billing service unavailable; no new inference permitted",
        },
      });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
  const store = new Store(pool);
  await store.init();
  const app = createApp(store, {
    adminKey: process.env.VENDOR_ADMIN_KEY,
    upstreamUrl: process.env.UPSTREAM_URL || "http://litellm:4000",
  });
  const server = app.listen(Number(process.env.PORT || 4050), "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 125000).unref();
    });
}
