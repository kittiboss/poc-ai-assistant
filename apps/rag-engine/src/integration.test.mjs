// Runs against a temporary database on the platform's rag-db (scripts/platform/rag-integration.mjs),
// connected as rag_app so row-level security is really in effect.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "./server.mjs";
import { KnowledgeStore, appUrl, migrate } from "./store.mjs";

const limits = {
  enabled: true,
  embeddingModels: ["mock-embedding", "gemini-embedding"],
  allowedTypes: ["csv", "txt", "md", "pdf"],
  maxDocuments: 3,
  maxFileMb: 5,
  maxTextMb: 1,
  maxChunksPerDocument: 400,
  maxTotalChunks: 500,
  maxTopK: 8,
};
const by = { userId: "user-1", roles: ["ADMIN", "USER"] };
/** A unit vector pointing at one dimension: identical axes score 1, different ones 0. */
const axis = (i) => Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0));
const doc = (text, extra = {}) => ({
  filename: "policy.txt",
  type: "txt",
  fileBytes: Buffer.byteLength(text),
  sections: [{ text }],
  requestedBy: by,
  ...extra,
});

test(
  "tenant isolation, limits and index versions (temporary database, as rag_app)",
  { skip: !process.env.RAG_TEST_DATABASE_URL },
  async (t) => {
    const ownerUrl = process.env.RAG_TEST_DATABASE_URL;
    const password = process.env.RAG_APP_DB_PASSWORD;
    const admin = new pg.Pool({ connectionString: ownerUrl });
    const database = `rag_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(ownerUrl);
    url.pathname = `/${database}`;
    await migrate(url.toString(), password);
    const pool = new pg.Pool({ connectionString: appUrl(url.toString(), password) });
    let server;
    t.after(async () => {
      if (server) await new Promise((r) => server.close(r));
      await pool.end();
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      await admin.end();
    });
    const store = new KnowledgeStore(pool);
    const a = { tenant: "a", limits };
    const b = { tenant: "b", limits };

    /** Embeds every pending passage of a tenant with the given vector. */
    async function embedAll(ctx, vector = () => axis(0)) {
      for (;;) {
        const next = await store.next(ctx, { maxItems: 100 });
        if (!next.items.length) return next;
        await store.storeVectors(ctx, {
          version: next.version,
          model: next.model,
          items: next.items.map((item, i) => ({ chunkId: item.chunkId, vector: vector(item, i) })),
        });
      }
    }

    await t.test("the application role cannot bypass row-level security", async () => {
      const { rows } = await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      assert.deepEqual(rows, [{ rolsuper: false, rolbypassrls: false }]);
    });

    let docA;
    await t.test("a tenant sees and searches only its own documents", async () => {
      docA = await store.addDocument(a, doc("Customer A refund window is 45 days."));
      const docB = await store.addDocument(b, doc("Customer B refund window is 10 days."));
      await embedAll(a);
      await embedAll(b);
      assert.deepEqual((await store.documents(a)).map((d) => d.id), [docA.id]);
      assert.deepEqual((await store.documents(b)).map((d) => d.id), [docB.id]);
      const found = await store.search(b, { model: "mock-embedding", vector: axis(0) });
      assert.deepEqual(found.citations.map((c) => c.documentId), [docB.id]);
      assert.match(found.citations[0].content, /10 days/);
      // B cannot touch A's document by id.
      await assert.rejects(store.setEnabled(b, docA.id, false), { status: 404 });
      await assert.rejects(store.deleteDocument(b, docA.id), { status: 404 });
      await assert.rejects(store.resume(b, { id: docA.id }), { status: 404 });
      assert.equal((await store.documents(a))[0].enabled, true);
    });

    await t.test("without a tenant context the role reads nothing", async () => {
      for (const table of ["rag.documents", "rag.chunks", "rag.settings"])
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
      await assert.rejects(
        pool.query(
          "INSERT INTO rag.documents(tenant_id, filename, type, file_bytes, text_bytes, sections, requested_by) VALUES('a','x','txt',1,1,'[]','{}')",
        ),
        /row-level security/,
      );
    });

    await t.test("a forged row cannot point into another tenant", async () => {
      await assert.rejects(
        store.withTenant("b", (db) =>
          db.query(
            "INSERT INTO rag.chunks(tenant_id, document_id, version, ordinal, title, content, embedding_model) VALUES('b',$1,1,99,'x','x','mock-embedding')",
            [docA.id],
          ),
        ),
        /foreign key/,
      );
      await assert.rejects(
        store.withTenant("b", (db) =>
          db.query(
            "INSERT INTO rag.chunks(tenant_id, document_id, version, ordinal, title, content, embedding_model) VALUES('a',$1,1,99,'x','x','mock-embedding')",
            [docA.id],
          ),
        ),
        /row-level security/,
      );
    });

    await t.test("vendor limits are enforced on upload", async () => {
      await assert.rejects(
        store.addDocument({ tenant: "a", limits: { ...limits, allowedTypes: ["pdf"] } }, doc("x")),
        { status: 400, type: "type_not_allowed" },
      );
      await assert.rejects(store.addDocument({ tenant: "a", limits: { ...limits, enabled: false } }, doc("x")), {
        status: 403,
      });
      await assert.rejects(store.addDocument(a, doc("x", { fileBytes: 6 * 1024 * 1024 })), { status: 409 });
      await assert.rejects(store.addDocument(a, doc("é".repeat(600_000))), { status: 409, type: "quota_exceeded" });
      await assert.rejects(
        store.addDocument({ tenant: "a", limits: { ...limits, maxChunksPerDocument: 1 } }, doc("y".repeat(3000))),
        { status: 409 },
      );
      await store.addDocument(a, doc("second"));
      await store.addDocument(a, doc("third"));
      await assert.rejects(store.addDocument(a, doc("fourth")), { status: 409, message: /3 documents/ });
      await embedAll(a);
    });

    await t.test("a small tenant still finds its passage beside a large tenant", async () => {
      const big = { tenant: "big", limits: { ...limits, maxTextMb: 10 } };
      // Over a hundred passages at exactly the query's vector, in the same HNSW graph.
      await store.addDocument(big, doc(Array.from({ length: 400 }, (_, i) => `row ${i}`.padEnd(400, ".")).join("")));
      await embedAll(big);
      const found = await store.search(b, { model: "mock-embedding", vector: axis(0) });
      assert.equal(found.citations.length, 1);
    });

    await t.test("settings change builds a new version; search switches when it is complete", async () => {
      const before = await store.config(a);
      assert.equal(before.active.version, 1);
      const changed = await store.updateSettings(a, { chunkSize: 400, chunkOverlap: 0, requestedBy: by });
      assert.equal(changed.reindex, true);
      const pending = await store.next(a, { maxItems: 1 });
      assert.equal(pending.version, 2);
      // The old version keeps answering while the new one is incomplete.
      assert.equal((await store.search(a, { model: "mock-embedding", vector: axis(0) })).version, 1);
      await assert.rejects(
        store.storeVectors(a, { version: 1, model: "mock-embedding", items: [{ chunkId: pending.items[0].chunkId, vector: axis(0) }] }),
        { status: 409, type: "stale_version" },
      );
      await embedAll(a);
      const after = await store.config(a);
      assert.deepEqual(after.active, { version: 2, model: "mock-embedding" });
      assert.equal((await store.search(a, { model: "mock-embedding", vector: axis(0) })).version, 2);
      await assert.rejects(store.search(a, { model: "gemini-embedding", vector: axis(0) }), { type: "model_mismatch" });
      // Top-K and minimum score change without re-indexing.
      assert.equal((await store.updateSettings(a, { topK: 1, minScore: 0.5, requestedBy: by })).reindex, false);
      assert.equal((await store.search(a, { model: "mock-embedding", vector: axis(0) })).citations.length, 1);
      assert.equal((await store.search(a, { model: "mock-embedding", vector: axis(1) })).citations.length, 0);
    });

    await t.test("lowered limits apply immediately", async () => {
      await store.updateSettings(a, { topK: 8, minScore: 0, requestedBy: by });
      const lowered = { tenant: "a", limits: { ...limits, maxTopK: 2 } };
      assert.equal((await store.search(lowered, { model: "mock-embedding", vector: axis(0) })).citations.length, 2);
      await assert.rejects(store.search({ tenant: "a", limits: { ...limits, embeddingModels: ["gemini-embedding"] } }, { model: "mock-embedding", vector: axis(0) }), {
        status: 409,
        type: "knowledge_unavailable",
      });
    });

    await t.test("indexing pauses with a reason and resumes", async () => {
      await store.updateSettings(a, { chunkSize: 500, chunkOverlap: 0, requestedBy: by });
      assert.ok((await store.pause(a, "CREDIT_EXHAUSTED")).paused > 0);
      assert.equal((await store.next(a)).items.length, 0);
      assert.ok((await store.documents(a)).every((d) => d.status === "PAUSED" && d.reason === "CREDIT_EXHAUSTED"));
      await store.resume(a, { reasons: ["POLICY"] });
      assert.equal((await store.next(a)).items.length, 0);
      await store.resume(a, { reasons: ["CREDIT_EXHAUSTED"] });
      await embedAll(a);
      assert.ok((await store.documents(a)).every((d) => d.status === "READY"));
    });

    await t.test("HTTP: tenant comes from the credential; admin routes need the admin key", async () => {
      const directory = new Map([
        ["sk-tenant-a-credential-0000", a],
        ["sk-tenant-b-credential-0000", b],
      ]);
      const app = createApp(store, {
        adminKey: "rag-admin-key-for-tests-only-000000",
        tenants: {
          resolve: async (key) => {
            if (!directory.has(key)) throw Object.assign(new Error("no"), { status: 401 });
            return directory.get(key);
          },
        },
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = (path, key, init = {}) =>
        fetch(`${base}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        });
      const listed = await (await call("/v1/documents", "sk-tenant-b-credential-0000")).json();
      assert.ok(listed.every((d) => !/45 days/.test(JSON.stringify(d))));
      // A tenant field in the body is ignored: identity comes from the credential.
      const created = await call("/v1/documents", "sk-tenant-b-credential-0000", {
        method: "POST",
        body: JSON.stringify({ ...doc("B only"), tenant: "a" }),
      });
      assert.equal(created.status, 201);
      const createdId = (await created.json()).id;
      assert.equal((await store.documents(a)).some((d) => d.id === createdId), false);
      assert.equal((await store.documents(b)).some((d) => d.id === createdId), true);
      assert.equal((await call("/admin/usage", "sk-tenant-a-credential-0000")).status, 401);
      const usage = await (await call("/admin/usage", "rag-admin-key-for-tests-only-000000")).json();
      assert.deepEqual(
        usage.tenants.map((u) => u.tenant),
        ["a", "b", "big"],
      );
      assert.ok(!/refund|content|sections/.test(JSON.stringify(usage)));
    });

    await t.test("purge removes one tenant's knowledge only", async () => {
      await store.purge("b");
      assert.equal((await store.documents(b)).length, 0);
      assert.ok((await store.documents(a)).length > 0);
    });
  },
);
