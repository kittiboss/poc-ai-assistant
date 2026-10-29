import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Store, defaultConfig } from "./store.mjs";
import { createApp } from "./server.mjs";

test(
  "transactional ledger and HTTP isolation (isolated temporary database, mock upstream only)",
  { skip: !process.env.VENDOR_TEST_DATABASE_URL },
  async (t) => {
    const adminPool = new pg.Pool({
      connectionString: process.env.VENDOR_TEST_DATABASE_URL,
    });
    const database = `vendor_test_${randomUUID().replaceAll("-", "")}`;
    await adminPool.query(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.VENDOR_TEST_DATABASE_URL);
    url.pathname = `/${database}`;
    const pool = new pg.Pool({ connectionString: url.toString() });
    let server;
    t.after(async () => {
      if (server) await new Promise((r) => server.close(r));
      await pool.end();
      await adminPool.query(`DROP DATABASE "${database}"`);
      await adminPool.end();
    });
    const store = new Store(pool);
    await store.init();
    const keyA = `sk-${randomUUID()}`,
      keyB = `sk-${randomUUID()}`;
    const configA = defaultConfig("a", "Customer A"),
      configB = defaultConfig("b", "Customer B");
    await store.register(configA, keyA, "0.001");
    await store.register(configB, keyB, "2");
    const a = await store.authenticate(keyA),
      b = await store.authenticate(keyB);
    const bounds = { input: 100, output: 100 };
    let reservation;
    await t.test(
      "concurrent requests cannot overspend the same balance",
      async () => {
        const results = await Promise.allSettled([
          store.reserve(a, "one", { model: "local-mock" }, bounds, "CHAT"),
          store.reserve(a, "two", { model: "local-mock" }, bounds, "CHAT"),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          results.find((r) => r.status === "rejected").reason.type,
          "budget_exceeded",
        );
        reservation =
          results[0].status === "fulfilled"
            ? { ...results[0].value, id: "one" }
            : { ...results[1].value, id: "two" };
        assert.ok((await store.balance("a")).reserved > 0);
        assert.equal((await store.balance("b")).remaining, 2);
      },
    );
    await t.test(
      "settlement is idempotent and uses the original immutable price version",
      async () => {
        await store.addPrice({
          model: "local-mock",
          strategy: "PERCENTAGE_MARKUP",
          inputCost: "1",
          outputCost: "1",
          markupPercent: 50,
        });
        const first = await store.settle(a, reservation.id, reservation, {
          prompt_tokens: 10,
          completion_tokens: 20,
        });
        const before = await store.balance("a");
        await store.settle(a, reservation.id, reservation, {
          prompt_tokens: 10,
          completion_tokens: 20,
        });
        assert.deepEqual(await store.balance("a"), before);
        assert.equal(first.charge, "0.000144640");
        assert.equal(
          (await store.billing(a)).requests[0].price_id,
          reservation.price.id,
        );
        await assert.rejects(
          store.reserve(
            a,
            reservation.id,
            { model: "local-mock" },
            bounds,
            "CHAT",
          ),
          { status: 409 },
        );
      },
    );
    await t.test(
      "top-ups are serialized and idempotent, conflicting retries rejected",
      async () => {
        const before = await store.balance("a");
        const receipts = await Promise.all(
          Array.from({ length: 8 }, () => store.grant("a", "2", "retry-safe")),
        );
        assert.equal(new Set(receipts.map((r) => r.id)).size, 1);
        assert.equal((await store.balance("a")).limit, before.limit + 2);
        await assert.rejects(store.grant("a", "3", "retry-safe"), {
          status: 409,
        });
        await assert.rejects(store.grant("a", "-1", "negative"), {
          status: 400,
        });
        assert.equal(receipts[0].simulation, true);
      },
    );
    await t.test(
      "restart/reprovision does not reset credit or grant a second opening balance",
      async () => {
        const before = await store.balance("a");
        const restarted = new Store(pool);
        await restarted.init();
        await restarted.register(configA, keyA, "100");
        assert.deepEqual(await restarted.balance("a"), before);
      },
    );
    await t.test(
      "knowledge limits are seeded once and survive re-provisioning",
      async () => {
        const key = `sk-${randomUUID()}`;
        await store.register(
          {
            ...defaultConfig("rag", "Knowledge"),
            rag: { maxTopK: 4, embeddingModels: ["mock-embedding"] },
          },
          key,
          "1",
        );
        const tenant = await store.authenticate(key);
        assert.equal(tenant.config.rag, undefined);
        assert.equal(store.ragFor(tenant).limits.maxTopK, 4);
        await store.setRag("rag", { maxTopK: 2 });
        // tenant:create and tenant:rotate re-register with the checked-in seed.
        await store.register(
          { ...defaultConfig("rag", "Knowledge"), rag: { maxTopK: 9 } },
          `sk-${randomUUID()}`,
        );
        const [row] = (await store.tenants()).filter((t) => t.id === "rag");
        assert.equal(row.rag.maxTopK, 2);
        await assert.rejects(store.setRag("rag", { maxTopK: 0 }), {
          status: 400,
        });
        await assert.rejects(store.setRag("missing", {}), { status: 404 });
      },
    );
    await t.test(
      "database refuses updates/deletes of historical prices and ledger entries",
      async () => {
        await assert.rejects(
          pool.query("UPDATE vendor.ledger SET amount=0"),
          /append-only/,
        );
        await assert.rejects(
          pool.query("DELETE FROM vendor.prices"),
          /append-only/,
        );
        assert.ok(
          (await store.prices(false, true)).length >
            (await store.prices()).length,
        );
      },
    );
    await t.test(
      "customer views exclude provider costs/markup and contain only this tenant",
      async () => {
        const billing = await store.billing(b);
        assert.equal(billing.transactions.length, 1);
        assert.equal(billing.requests.length, 0);
        assert.ok(
          !/inputCost|outputCost|markup|token_hash|simulatedProviderCost/.test(
            JSON.stringify(billing),
          ),
        );
      },
    );
    await t.test(
      "unknown models and rotated/suspended credentials fail closed",
      async () => {
        await assert.rejects(
          store.reserve(a, "denied", { model: "paid-model" }, bounds, "CHAT"),
          { status: 403 },
        );
        await pool.query(
          "UPDATE vendor.tenants SET enabled=false WHERE id=$1",
          ["a"],
        );
        await assert.rejects(store.authenticate(keyA), { status: 401 });
        await assert.rejects(
          store.reserve(
            a,
            "suspended",
            { model: "local-mock" },
            bounds,
            "CHAT",
          ),
          { status: 401 },
        );
        await pool.query("UPDATE vendor.tenants SET enabled=true WHERE id=$1", [
          "a",
        ]);
      },
    );
    let upstreamCalls = 0;
    const ragCalls = [];
    const app = createApp(store, {
      adminKey: "vendor-test-key-that-is-not-a-real-secret",
      upstreamUrl: "http://mock.invalid",
      ragEngineUrl: "http://rag.invalid",
      ragAdminKey: "rag-admin-test-key",
      fetchRag: async (url, init) => {
        ragCalls.push({ url, init });
        return Response.json({ tenants: [] });
      },
      fetchUpstream: async (path, init) => {
        upstreamCalls++;
        const body = JSON.parse(init.body);
        assert.ok(init.headers["x-request-id"]);
        assert.equal(body.api_base, undefined);
        if (body.messages?.[0]?.content === "rate")
          return new Response("{}", { status: 429 });
        if (body.messages?.[0]?.content === "disconnect")
          throw new Error("simulated timeout");
        if (path.endsWith("embeddings"))
          return Response.json({
            data: [{ embedding: [1, 0], index: 0 }],
            usage: { prompt_tokens: 2, completion_tokens: 0 },
          });
        return new Response(
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
        );
      },
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (path, body, key = keyB, extra = {}) =>
      fetch(`${base}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "x-request-id": randomUUID(),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const chat = {
      model: "local-mock",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      max_tokens: 32,
    };
    await t.test(
      "tenant cannot access console/admin, other ledger, or routing bypass",
      async () => {
        assert.equal((await call("/admin/tenants")).status, 401);
        assert.equal((await call("/console/")).status, 401);
        assert.equal((await call("/key/generate", {})).status, 404);
        assert.equal(
          (
            await call(
              "/customer/topups",
              { amount: "2", reference: "cross-origin" },
              keyB,
              { origin: "https://attacker.invalid" },
            )
          ).status,
          403,
        );
        assert.equal(
          (await call("/customer/billing", undefined, "wrong")).status,
          401,
        );
      },
    );
    await t.test(
      "each tenant reads only its own knowledge limits; only the vendor edits them",
      async () => {
        const own = await (await call("/customer/rag", undefined, keyB)).json();
        assert.equal(own.tenant, "b");
        assert.deepEqual(own.limits.embeddingModels, ["mock-embedding"]);
        assert.ok(!/token_hash|balance/.test(JSON.stringify(own)));
        assert.equal((await call("/customer/rag", undefined, "wrong")).status, 401);
        const asTenant = await fetch(`${base}/admin/tenants/b/rag`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${keyB}`, "Content-Type": "application/json" },
          body: JSON.stringify({ maxTopK: 10 }),
        });
        assert.equal(asTenant.status, 401);
        const vendor = {
          Authorization: "Bearer vendor-test-key-that-is-not-a-real-secret",
          "Content-Type": "application/json",
        };
        const saved = await fetch(`${base}/admin/tenants/b/rag`, {
          method: "PATCH",
          headers: vendor,
          body: JSON.stringify({ maxTopK: 3 }),
        });
        assert.equal(saved.status, 200);
        assert.equal(
          (await (await call("/customer/rag", undefined, keyB)).json()).limits.maxTopK,
          3,
        );
        assert.equal(
          (await fetch(`${base}/admin/rag/usage`, { headers: vendor })).status,
          200,
        );
        assert.equal(
          (await fetch(`${base}/admin/tenants/b/rag-data`, { method: "DELETE", headers: vendor })).status,
          200,
        );
        assert.deepEqual(
          ragCalls.map(({ url, init }) => [url, init.method, init.headers.Authorization]),
          [
            ["http://rag.invalid/admin/usage", "GET", "Bearer rag-admin-test-key"],
            ["http://rag.invalid/admin/tenants/b", "DELETE", "Bearer rag-admin-test-key"],
          ],
        );
      },
    );
    await t.test(
      "streaming completion debits synchronously, returns billing snapshot and prevents replay",
      async () => {
        const id = randomUUID();
        const before = await store.balance("b");
        const response = await call("/v1/chat/completions", chat, keyB, {
          "x-request-id": id,
        });
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.match(text, /hello/);
        assert.match(text, /"billing"/);
        assert.match(text, /\[DONE\]/);
        const after = await store.balance("b");
        assert.ok(after.spent > before.spent);
        assert.equal(after.reserved, 0);
        assert.equal(
          (
            await call("/v1/chat/completions", chat, keyB, {
              "x-request-id": id,
            })
          ).status,
          409,
        );
      },
    );
    await t.test("embeddings are metered in the same ledger", async () => {
      const response = await call("/v1/embeddings", {
        model: "mock-embedding",
        input: ["hello"],
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.billing.charge, "0.000000400");
    });
    await t.test(
      "upstream quota rejection releases the reservation without charging",
      async () => {
        const before = await store.balance("b");
        assert.equal(
          (
            await call("/v1/chat/completions", {
              ...chat,
              messages: [{ role: "user", content: "rate" }],
            })
          ).status,
          429,
        );
        assert.deepEqual(await store.balance("b"), before);
      },
    );
    await t.test(
      "today's usage per customer and model leaves out rejected calls",
      async () => {
        const key = `sk-${randomUUID()}`;
        await store.register(
          {
            ...defaultConfig("usage", "Usage"),
            models: ["local-mock", "groq-llama"],
          },
          key,
          "1",
        );
        for (const [model, content] of [
          ["local-mock", "hello"],
          ["groq-llama", "hello"],
          ["groq-llama", "rate"],
        ])
          await (
            await call(
              "/v1/chat/completions",
              { ...chat, model, messages: [{ role: "user", content }] },
              key,
            )
          ).text();
        const response = await call(
          "/admin/usage/today",
          undefined,
          "vendor-test-key-that-is-not-a-real-secret",
        );
        assert.equal(response.status, 200);
        const usage = (await response.json()).tenants.find(
          (t) => t.tenant === "usage",
        );
        assert.deepEqual(usage.limits, { requests: 33, tokens: 33333 });
        assert.deepEqual(usage.external, { requests: 1, tokens: 5 });
        assert.deepEqual(usage.models, [
          {
            model: "local-mock",
            external: false,
            requests: 1,
            running: 0,
            tokens: 5,
          },
          {
            model: "groq-llama",
            external: true,
            requests: 1,
            running: 0,
            tokens: 5,
          },
        ]);
        assert.equal(
          (await call("/admin/usage/today", undefined, key)).status,
          401,
        );
      },
    );
    await t.test(
      "uncertain network failure cannot be abused for free requests; labelled estimated",
      async () => {
        assert.equal(
          (
            await call("/v1/chat/completions", {
              ...chat,
              messages: [{ role: "user", content: "disconnect" }],
            })
          ).status,
          502,
        );
        const billing = await store.billing(b);
        assert.equal(billing.requests[0].state, "ESTIMATED");
        assert.equal(billing.credit.reserved, 0);
      },
    );
    await t.test(
      "zero credit fails before calling any model, top-up restores access immediately",
      async () => {
        const key = `sk-${randomUUID()}`;
        await store.register(defaultConfig("empty", "Empty"), key, "0");
        const before = upstreamCalls;
        assert.equal(
          (await call("/v1/chat/completions", chat, key)).status,
          402,
        );
        assert.equal(upstreamCalls, before);
        const receipt = await (
          await call(
            "/customer/topups",
            { amount: "1", reference: "restore" },
            key,
          )
        ).json();
        assert.equal(receipt.simulation, true);
        const response = await call("/v1/chat/completions", chat, key);
        assert.equal(response.status, 200);
        await response.text();
      },
    );
  },
);
