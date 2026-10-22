import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { charge, money, priceInput, usd } from "./money.mjs";

export const hash = (key) => createHash("sha256").update(key).digest("hex");
export class Fault extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}
const bad = (message) => new Fault(400, "invalid_request", message);
export const validId = (id) => /^[a-z0-9][a-z0-9-]{0,19}$/.test(id ?? "");
export const models = [
  "local-mock",
  "mock-embedding",
  "google-gemini",
  "gemini-embedding",
  "groq-llama",
  "openrouter-free",
];
export const defaultConfig = (id, name, webPort = 3100) => ({
  id,
  name,
  webPort,
  apiPort: webPort + 1,
  initialCreditUsd: 2,
  models: ["local-mock", "mock-embedding"],
  modelRateLimits: {
    "google-gemini": { rpm: 5, tpm: 80000 },
    "gemini-embedding": { rpm: 5, tpm: 80000 },
    "groq-llama": { rpm: 10, tpm: 2000 },
    "openrouter-free": { rpm: 6 },
  },
  dailyExternalLimits: { requests: 33, tokens: 33333 },
  embeddingBatch: { size: 8, intervalMs: 15500 },
});

export class Store {
  constructor(pool) {
    this.pool = pool;
  }
  async init() {
    await this.pool.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    // Serialize first-boot seeding across replicas. Versions are never updated in place.
    await this.tx(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(410522)");
      for (const [model, inputRate, outputRate] of [
        ["local-mock", "3.75", "5.357"],
        ["mock-embedding", ".2", "0"],
        ["google-gemini", ".3", "2.5"],
        ["gemini-embedding", ".2", "0"],
        ["groq-llama", ".1", ".5"],
        ["openrouter-free", ".1", ".5"],
      ]) {
        if (
          !(
            await db.query("SELECT 1 FROM vendor.prices WHERE model=$1", [
              model,
            ])
          ).rowCount
        )
          await this.addPrice(
            {
              model,
              inputCost: String(Number(inputRate) / 1.5),
              outputCost: String(Number(outputRate) / 1.5),
              inputRate: String(Number(inputRate)),
              outputRate: String(Number(outputRate)),
              strategy: "FIXED_RATE",
              markupPercent: 0,
            },
            db,
            true,
          );
      }
    });
  }
  async tx(fn) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const value = await fn(db);
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async authenticate(key) {
    const {
      rows: [tenant],
    } = await this.pool.query(
      "SELECT * FROM vendor.tenants WHERE token_hash=$1 AND enabled=true",
      [hash(key)],
    );
    if (!tenant)
      throw new Fault(
        401,
        "unauthorized",
        "Invalid or suspended tenant credential",
      );
    return tenant;
  }
  async register(config, key, opening = 0) {
    if (
      !validId(config?.id) ||
      typeof config.name !== "string" ||
      !config.name.trim() ||
      config.name.length > 100 ||
      !Array.isArray(config.models) ||
      !config.models.length ||
      config.models.some((m) => !models.includes(m))
    )
      throw bad("Invalid tenant configuration");
    if (
      key !== undefined &&
      (typeof key !== "string" || !key.startsWith("sk-") || key.length < 20)
    )
      throw bad("Invalid gateway credential");
    return this.tx(async (db) => {
      const created = await db.query(
        "INSERT INTO vendor.tenants(id,name,config,token_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
        [config.id, config.name, config, key ? hash(key) : null],
      );
      if (!created.rowCount && key)
        await db.query(
          "UPDATE vendor.tenants SET name=$2,config=$3,token_hash=$4 WHERE id=$1",
          [config.id, config.name, config, hash(key)],
        );
      if (created.rowCount)
        await this.grant(config.id, opening, "opening", "OPENING", db);
      return { id: config.id, created: !!created.rowCount };
    });
  }
  async grant(id, amount, reference, kind = "TOPUP", transaction) {
    let value;
    try {
      value = money(amount);
    } catch {
      throw bad("Invalid USD amount");
    }
    if (
      value < 0n ||
      value > money(10000) ||
      (kind !== "OPENING" && value === 0n)
    )
      throw bad("Amount must be between 0 and 10000 simulated USD");
    if (
      typeof reference !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,120}$/.test(reference)
    )
      throw bad("Invalid idempotency reference");
    const run = async (db) => {
      if (
        !(
          await db.query(
            "SELECT id FROM vendor.tenants WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rowCount
      )
        throw new Fault(404, "not_found", "Unknown tenant");
      const {
        rows: [previous],
      } = await db.query(
        "SELECT * FROM vendor.ledger WHERE tenant=$1 AND reference=$2",
        [id, reference],
      );
      if (previous) {
        if (BigInt(previous.amount) !== value || previous.kind !== kind)
          throw new Fault(
            409,
            "idempotency_conflict",
            "Reference already used for a different transaction",
          );
        return this.receipt(previous);
      }
      const {
        rows: [entry],
      } = await db.query(
        "INSERT INTO vendor.ledger(tenant,reference,kind,amount) VALUES($1,$2,$3,$4) RETURNING *",
        [id, reference, kind, value.toString()],
      );
      await db.query(
        "UPDATE vendor.tenants SET balance=balance+$2 WHERE id=$1",
        [id, value.toString()],
      );
      return this.receipt(entry);
    };
    return transaction ? run(transaction) : this.tx(run);
  }
  receipt(row) {
    return {
      id: `SIM-${row.id}`,
      reference: row.reference,
      kind: row.kind,
      amount: usd(row.amount),
      createdAt: row.created_at,
      simulation: true,
      currency: "USD",
      note: "TEST CREDIT ONLY — no payment received; not a tax invoice.",
    };
  }
  async prices(customer = false, history = false) {
    const { rows } = await this.pool.query(
      history
        ? "SELECT * FROM vendor.prices ORDER BY id DESC LIMIT 100"
        : "SELECT DISTINCT ON(model) * FROM vendor.prices ORDER BY model,id DESC",
    );
    return rows.map((p) => ({
      id: p.id,
      model: p.model,
      inputRate: usd(p.input_rate),
      outputRate: usd(p.output_rate),
      unit: "USD / 1M tokens",
      createdAt: p.created_at,
      ...(!customer
        ? {
            inputCost: usd(p.input_cost),
            outputCost: usd(p.output_cost),
            strategy: p.strategy,
            markupPercent: p.markup,
          }
        : {}),
    }));
  }
  async addPrice(body, db = this.pool, seed = false) {
    if (!models.includes(body.model)) throw bad("Unknown model");
    let price;
    try {
      price = priceInput(
        seed
          ? {
              ...body,
              inputCost: Number(body.inputCost).toFixed(9),
              outputCost: Number(body.outputCost).toFixed(9),
            }
          : body,
      );
    } catch (error) {
      throw bad(error.message);
    }
    const {
      rows: [row],
    } = await db.query(
      "INSERT INTO vendor.prices(model,input_rate,output_rate,input_cost,output_cost,strategy,markup) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [
        body.model,
        price.input.toString(),
        price.output.toString(),
        price.inputCost.toString(),
        price.outputCost.toString(),
        price.strategy,
        price.markup,
      ],
    );
    return { id: row.id };
  }
  async balance(id, db = this.pool) {
    const {
      rows: [row],
    } = await db.query(
      `SELECT t.balance,
      (SELECT COALESCE(sum(reserved),0) FROM vendor.requests WHERE tenant=t.id AND state='PENDING') held,
      (SELECT COALESCE(sum(amount),0) FROM vendor.ledger WHERE tenant=t.id AND amount>0) granted
      FROM vendor.tenants t WHERE id=$1`,
      [id],
    );
    if (!row) throw new Fault(404, "not_found", "Unknown tenant");
    const remaining = BigInt(row.balance) - BigInt(row.held);
    return {
      currency: "USD",
      simulation: true,
      limit: Number(usd(row.granted)),
      spent: Number(usd(BigInt(row.granted) - BigInt(row.balance))),
      balance: Number(usd(row.balance)),
      reserved: Number(usd(row.held)),
      remaining: Number(usd(remaining)),
      exhausted: remaining <= 0n,
      lowCredit: remaining < money("0.1"),
    };
  }
  async billing(tenant) {
    const { rows } = await this.pool.query(
      "SELECT * FROM vendor.ledger WHERE tenant=$1 ORDER BY id DESC LIMIT 100",
      [tenant.id],
    );
    const requests = await this.pool.query(
      "SELECT request_id,model,kind,state,input_tokens,output_tokens,charge,price_id,created_at FROM vendor.requests WHERE tenant=$1 ORDER BY created_at DESC LIMIT 100",
      [tenant.id],
    );
    return {
      credit: await this.balance(tenant.id),
      prices: (await this.prices(true)).filter((p) =>
        tenant.config.models.includes(p.model),
      ),
      transactions: rows.map((row) => this.receipt(row)),
      requests: requests.rows.map(({ charge: amount, ...r }) => ({
        ...r,
        charge: amount === null ? null : usd(amount),
      })),
    };
  }
  async reserve(tenant, requestId, body, bounds, kind) {
    if (
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,120}$/.test(requestId)
    )
      throw bad("A valid X-Request-Id is required");
    return this.tx(async (db) => {
      const {
        rows: [fresh],
      } = await db.query(
        "SELECT * FROM vendor.tenants WHERE id=$1 FOR UPDATE",
        [tenant.id],
      );
      if (!fresh?.enabled || fresh.token_hash !== tenant.token_hash)
        throw new Fault(401, "unauthorized", "Credential revoked");
      if (!fresh.config.models.includes(body.model))
        throw new Fault(
          403,
          "key_model_access_denied",
          "Model is not included in this tenant plan",
        );
      if (
        (
          await db.query(
            "SELECT 1 FROM vendor.requests WHERE tenant=$1 AND request_id=$2",
            [tenant.id, requestId],
          )
        ).rowCount
      )
        throw new Fault(
          409,
          "duplicate_request",
          "This request ID has already been submitted",
        );
      const {
        rows: [price],
      } = await db.query(
        "SELECT * FROM vendor.prices WHERE model=$1 ORDER BY id DESC LIMIT 1",
        [body.model],
      );
      if (!price) throw bad("No sale price configured");
      const reserved = charge(bounds.input, bounds.output, price);
      const {
        rows: [held],
      } = await db.query(
        "SELECT COALESCE(sum(reserved),0) AS total FROM vendor.requests WHERE tenant=$1 AND state='PENDING'",
        [tenant.id],
      );
      if (BigInt(fresh.balance) - BigInt(held.total) < reserved)
        throw new Fault(
          402,
          "budget_exceeded",
          "Insufficient test credit for the maximum request cost. Top up or lower max_tokens.",
        );
      await db.query(
        "INSERT INTO vendor.requests(tenant,request_id,model,kind,price_id,reserved) VALUES($1,$2,$3,$4,$5,$6)",
        [tenant.id, requestId, body.model, kind, price.id, reserved.toString()],
      );
      return { price, reserved, input: bounds.input, output: bounds.output };
    });
  }
  async settle(tenant, requestId, reservation, usage, rejected = false) {
    const valid =
      usage &&
      Number.isSafeInteger(usage.prompt_tokens) &&
      usage.prompt_tokens >= 0 &&
      Number.isSafeInteger(usage.completion_tokens ?? 0) &&
      (usage.completion_tokens ?? 0) >= 0;
    const input = rejected
      ? 0
      : valid
        ? usage.prompt_tokens
        : reservation.input;
    const output = rejected
      ? 0
      : valid
        ? (usage.completion_tokens ?? 0)
        : reservation.output;
    const calculated = charge(input, output, reservation.price);
    // Unexpected tokenization overrun is absorbed by the vendor; never create customer debt.
    const amount =
      calculated > reservation.reserved ? reservation.reserved : calculated;
    const cost = charge(input, output, {
      input_rate: reservation.price.input_cost,
      output_rate: reservation.price.output_cost,
    });
    await this.tx(async (db) => {
      await db.query("SELECT id FROM vendor.tenants WHERE id=$1 FOR UPDATE", [
        tenant.id,
      ]);
      const updated = await db.query(
        "UPDATE vendor.requests SET state=$3,input_tokens=$4,output_tokens=$5,charge=$6,cost=$7,completed_at=now() WHERE tenant=$1 AND request_id=$2 AND state='PENDING' RETURNING request_id",
        [
          tenant.id,
          requestId,
          rejected ? "REJECTED" : valid ? "COMPLETED" : "ESTIMATED",
          input,
          output,
          amount.toString(),
          cost.toString(),
        ],
      );
      if (!updated.rowCount) return;
      await db.query(
        "UPDATE vendor.tenants SET balance=balance-$2 WHERE id=$1",
        [tenant.id, amount.toString()],
      );
      await db.query(
        "INSERT INTO vendor.ledger(tenant,reference,kind,amount) VALUES($1,$2,$3,$4)",
        [
          tenant.id,
          `request:${requestId}`,
          rejected ? "REJECTED" : valid ? "DEBIT" : "ESTIMATED_DEBIT",
          (-amount).toString(),
        ],
      );
    });
    return {
      requestId,
      charge: usd(amount),
      priceVersion: reservation.price.id,
      estimated: !valid && !rejected,
      simulation: true,
    };
  }
  async tenants() {
    const { rows } = await this.pool
      .query(`SELECT t.id,t.name,t.enabled,t.config,t.token_hash IS NOT NULL AS provisioned,
      (SELECT COALESCE(sum(cost),0) FROM vendor.requests WHERE tenant=t.id) cost,
      (SELECT count(*) FROM vendor.requests WHERE tenant=t.id AND state='PENDING') pending,
      (SELECT count(*) FROM vendor.requests WHERE tenant=t.id) requests FROM vendor.tenants t ORDER BY id`);
    return Promise.all(
      rows.map(async ({ cost, ...t }) => ({
        ...t,
        credit: await this.balance(t.id),
        simulatedProviderCost: usd(cost),
        actualProviderCost: "0.000000000",
      })),
    );
  }
}
