import test from "node:test";
import assert from "node:assert/strict";
import { chunkSections, documentInput } from "./chunk.mjs";
import { defaultSettings, effectiveSettings, reindexNeeded, settingsInput } from "./settings.mjs";
import { Tenants } from "./tenants.mjs";

const limits = {
  enabled: true,
  embeddingModels: ["mock-embedding", "gemini-embedding"],
  allowedTypes: ["csv", "txt", "md", "pdf"],
  maxDocuments: 20,
  maxFileMb: 5,
  maxTextMb: 10,
  maxChunksPerDocument: 500,
  maxTotalChunks: 3000,
  maxTopK: 8,
};

test("documents are validated and their stored text size is measured, not trusted", () => {
  const doc = documentInput({
    filename: " policy.pdf ",
    type: "pdf",
    fileBytes: 2048,
    textBytes: 1, // ignored
    sections: [
      { text: "หน้าแรก", page: 1 },
      { text: "Second page", page: 2, title: "Policy" },
    ],
  });
  assert.equal(doc.filename, "policy.pdf");
  assert.equal(doc.textBytes, Buffer.byteLength("หน้าแรก") + Buffer.byteLength("Second page") + Buffer.byteLength("Policy"));
  for (const bad of [
    { filename: "a.docx", type: "docx", fileBytes: 1, sections: [{ text: "x" }] },
    { filename: "a.txt", type: "txt", fileBytes: 0, sections: [{ text: "x" }] },
    { filename: "a.txt", type: "txt", fileBytes: 1, sections: [] },
    { filename: "a.txt", type: "txt", fileBytes: 1, sections: [{ text: "  " }] },
    { filename: "a.pdf", type: "pdf", fileBytes: 1, sections: [{ text: "x", page: 0 }] },
  ])
    assert.throws(() => documentInput(bad), { status: 400 });
});

test("text is split with the tenant's chunk size and overlap, keeping PDF pages", () => {
  const doc = { filename: "guide.pdf", sections: [{ text: "a".repeat(1000), page: 3 }, { text: "short", page: 4 }] };
  const chunks = chunkSections(doc, { chunkSize: 400, chunkOverlap: 100 });
  assert.deepEqual(
    chunks.map((c) => [c.ordinal, c.page, c.content.length]),
    [
      [0, 3, 400],
      [1, 3, 400],
      [2, 3, 400],
      [3, 4, 5],
    ],
  );
  assert.equal(chunks[0].title, "guide.pdf");
  // A CSV row stays one passage with its own title.
  const rows = chunkSections(
    { filename: "catalog.csv", sections: [{ title: "Widget (W-1)", text: "Product: Widget" }] },
    { chunkSize: 1400, chunkOverlap: 300 },
  );
  assert.deepEqual(rows, [{ ordinal: 0, page: null, title: "Widget (W-1)", content: "Product: Widget" }]);
});

test("tenant settings stay inside the vendor's limits and the platform's ranges", () => {
  const current = defaultSettings(limits);
  assert.deepEqual(current, { embeddingModel: "mock-embedding", topK: 5, minScore: 0, chunkSize: 1400, chunkOverlap: 300 });
  assert.equal(settingsInput({ topK: 8 }, current, limits).topK, 8);
  for (const bad of [
    { topK: 9 },
    { topK: 0 },
    { minScore: 0.95 },
    { chunkSize: 300 },
    { chunkSize: 1000, chunkOverlap: 401 },
    { embeddingModel: "text-embedding-3-large" },
    { tenant: "b" },
  ])
    assert.throws(() => settingsInput(bad, current, limits), { status: 400 }, JSON.stringify(bad));
  // After the vendor lowers the top-K limit, other settings can still change.
  assert.equal(settingsInput({ chunkSize: 800 }, { ...current, topK: 8 }, { ...limits, maxTopK: 2 }).topK, 2);
  assert.throws(() => settingsInput({ topK: 3 }, current, { ...limits, maxTopK: 2 }), { status: 400 });
  assert.equal(reindexNeeded(current, { ...current, topK: 2 }), false);
  assert.equal(reindexNeeded(current, { ...current, chunkSize: 800 }), true);
});

test("lowered vendor limits clamp what applies and explain why search is off", () => {
  const settings = { embeddingModel: "gemini-embedding", topK: 8, minScore: 0.2, chunkSize: 1400, chunkOverlap: 300 };
  const lowered = { ...limits, maxTopK: 2, embeddingModels: ["mock-embedding"] };
  const effective = effectiveSettings(settings, lowered, { version: 1, model: "gemini-embedding" });
  assert.equal(effective.topK, 2);
  assert.match(effective.problem, /no longer in your plan/);
  assert.match(effectiveSettings(settings, { ...limits, enabled: false }, null).problem, /turned off/);
  assert.equal(effectiveSettings(settings, limits, null).problem, null);
});

test("tenants are resolved by vendor-control and cached by credential hash", async () => {
  let calls = 0;
  let clock = 0;
  const tenants = new Tenants({
    vendorUrl: "http://vendor.invalid",
    now: () => clock,
    fetchVendor: async (url, init) => {
      calls++;
      assert.equal(url, "http://vendor.invalid/customer/rag");
      if (init.headers.Authorization === "Bearer sk-revoked-credential-0000")
        return new Response("{}", { status: 401 });
      return Response.json({ tenant: "a", limits });
    },
  });
  const key = "sk-valid-credential-00000";
  assert.equal((await tenants.resolve(key)).tenant, "a");
  await tenants.resolve(key);
  assert.equal(calls, 1);
  clock = 31_000;
  await tenants.resolve(key);
  assert.equal(calls, 2);
  await assert.rejects(tenants.resolve("sk-revoked-credential-0000"), { status: 401 });
  await assert.rejects(tenants.resolve("sk-revoked-credential-0000"), { status: 401 });
  assert.equal(calls, 3);
  await assert.rejects(tenants.resolve("not-a-key"), { status: 401 });
  assert.ok(![...tenants.cache.keys()].some((id) => id.includes("credential")));
});
