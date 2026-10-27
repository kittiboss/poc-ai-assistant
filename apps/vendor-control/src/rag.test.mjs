import test from "node:test";
import assert from "node:assert/strict";
import { defaultRag, effectiveRag, ragInput } from "./rag.mjs";

test("new tenants get mock-only knowledge limits", () => {
  assert.deepEqual(defaultRag().embeddingModels, ["mock-embedding"]);
  assert.deepEqual(ragInput(defaultRag()), defaultRag());
});

test("knowledge limits are validated and merged over the current ones", () => {
  const next = ragInput({ maxTopK: 3, allowedTypes: ["pdf", "txt"] });
  assert.equal(next.maxTopK, 3);
  assert.deepEqual(next.allowedTypes, ["txt", "pdf"]);
  assert.equal(next.maxDocuments, defaultRag().maxDocuments);
  for (const bad of [
    { maxTopK: 11 },
    { maxFileMb: 6 },
    { maxDocuments: 1.5 },
    { allowedTypes: ["docx"] },
    { allowedTypes: ["pdf", "pdf"] },
    { embeddingModels: ["text-embedding-3-large"] },
    { embeddingModels: [] },
    { enabled: "yes" },
    { maxChunksPerDocument: 600, maxTotalChunks: 500 },
    { unexpected: 1 },
    null,
  ])
    assert.throws(() => ragInput(bad), undefined, JSON.stringify(bad));
  // A disabled tenant may have no models or types selected.
  assert.equal(
    ragInput({ enabled: false, embeddingModels: [], allowedTypes: [] }).enabled,
    false,
  );
});

test("the engine only sees embedding models the tenant's plan includes", () => {
  const rag = ragInput({
    embeddingModels: ["mock-embedding", "gemini-embedding"],
  });
  assert.deepEqual(
    effectiveRag(rag, { models: ["local-mock", "mock-embedding"] })
      .embeddingModels,
    ["mock-embedding"],
  );
  assert.deepEqual(effectiveRag(null, { models: ["mock-embedding"] }), {
    ...defaultRag(),
    embeddingModels: ["mock-embedding"],
  });
});
