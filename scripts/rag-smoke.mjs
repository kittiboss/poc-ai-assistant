// Product-catalog RAG smoke test against a running stack. Non-destructive: it never
// imports data, only indexes (incrementally) and asks one catalog question.
// With an external embedding model it calls that provider, so it then requires
// ALLOW_EXTERNAL_EMBEDDINGS=1 (see `npm run test:rag:gemini`).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { login, request } from "./test-client.mjs";

const chatModel = process.env.RAG_CHAT_MODEL || "local-mock";
// External chat models are ADMIN-only by default, so the Gemini variant chats as admin.
const chatAs = process.env.RAG_CHAT_AS === "admin" ? "admin" : "employee1";
const question = "Which earbuds have IPX5 sweat and water resistance?";

const admin = await login(
  "admin",
  process.env.ADMIN_DEMO_PASSWORD || "Admin123!",
);
const employee = await login(
  "employee1",
  process.env.EMPLOYEE_DEMO_PASSWORD || "Employee123!",
);
const json = async (response, expected = 200) => {
  const body = await response.json().catch(() => ({}));
  assert.equal(
    response.status,
    expected,
    `${response.url} → ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
  );
  return body;
};

const before = await json(await request("/knowledge/status", employee.token));
assert(before.products > 0, "the product catalog is empty");
if (
  before.embeddingModel.local === false &&
  process.env.ALLOW_EXTERNAL_EMBEDDINGS !== "1"
) {
  console.log(
    JSON.stringify({
      rag: "skipped",
      reason: `${before.embeddingModel.displayName} is external; run npm run test:rag:gemini to call it`,
    }),
  );
  process.exit(0);
}
assert(before.ready, `embedding model not ready: ${before.problem}`);

// Employees cannot index; invalid CSV is rejected as a whole with row-level reasons.
assert.equal(
  (
    await request("/admin/knowledge/reindex", employee.token, {
      method: "POST",
    })
  ).status,
  403,
);
const bad = new FormData();
bad.append(
  "file",
  new Blob(["product_id,sku\n1,ONLY-TWO-COLUMNS\n"], { type: "text/csv" }),
  "bad.csv",
);
const rejected = await json(
  await fetch(
    `${process.env.API_URL || "http://localhost:3001/api"}/admin/knowledge/products/import`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: bad,
    },
  ),
  400,
);
assert(rejected.errors.some((error) => error.startsWith("missing column(s)")));

// Indexing runs in the background; external models are paced to the provider quota.
const indexed = await json(
  await request("/admin/knowledge/reindex", admin.token, { method: "POST" }),
);
const deadline =
  Date.now() +
  (indexed.estimatedSeconds + 90 * Math.max(1, indexed.batches)) * 1000;
let progress = await json(await request("/knowledge/status", admin.token));
while (progress.indexing) {
  assert(Date.now() < deadline, "indexing did not finish in time");
  await new Promise((resolve) => setTimeout(resolve, 3000));
  progress = await json(await request("/knowledge/status", admin.token));
}
assert.equal(
  progress.lastRun?.error ?? null,
  null,
  `indexing stopped: ${progress.lastRun?.error}`,
);
const repeat = await json(
  await request("/admin/knowledge/reindex", admin.token, { method: "POST" }),
);
assert.equal(
  repeat.started,
  false,
  "an unchanged catalog must not be re-embedded",
);
const after = await json(await request("/knowledge/status", employee.token));
assert(
  after.available && after.stale === 0 && after.indexed === after.products,
  `catalog not fully indexed: ${JSON.stringify(after)}`,
);

const chatter = chatAs === "admin" ? admin : employee;
const conversation = await json(
  await request("/conversations", chatter.token, {
    method: "POST",
    body: JSON.stringify({ title: "RAG smoke test" }),
  }),
  201,
);
const requestId = randomUUID();
const response = await request(
  `/conversations/${conversation.id}/messages`,
  chatter.token,
  {
    method: "POST",
    body: JSON.stringify({
      content: question,
      modelId: chatModel,
      requestId,
      useProductCatalog: true,
    }),
  },
);
assert.equal(
  response.status,
  200,
  `chat failed: ${await response.clone().text()}`,
);
const frames = (await response.text()).split("\n\n");
const error = frames.find((frame) => frame.startsWith("event: error"));
assert(!error, `generation failed: ${error}`);
const done = JSON.parse(
  frames
    .find((frame) => frame.startsWith("event: done"))
    .match(/^data:\s*(.+)$/m)[1],
);
const answer = frames
  .filter((frame) => frame.startsWith("event: token"))
  .map((frame) => JSON.parse(frame.match(/^data:\s*(.+)$/m)[1]).text)
  .join("");
const products = done.citations.filter(
  (citation) => citation.kind === "product",
);
assert(products.length > 0, "no product citations were returned");
assert.match(
  products[0].filename,
  /ELC-0002/,
  `expected the IPX5 earbuds first, got ${products.map((p) => p.filename).join(", ")}`,
);

const usage = await json(await request("/usage/me", chatter.token));
const retrieval = usage.records.find(
  (record) => record.requestId === `${requestId}:retrieval`,
);
assert(
  retrieval &&
    retrieval.operation === "EMBEDDING" &&
    retrieval.conversationId === conversation.id,
  "retrieval embedding usage was not recorded",
);

console.log(
  JSON.stringify(
    {
      rag: "passed",
      embeddingModel: after.embeddingModel.id,
      indexed: {
        products: after.products,
        embeddedThisRun: progress.lastRun?.embedded ?? 0,
        requests: indexed.batches,
        repeatRunStarted: repeat.started,
      },
      question,
      topProducts: products
        .slice(0, 3)
        .map((p) => `${p.label} ${p.filename} (${p.score})`),
      chatModel,
      chatAs,
      answer: answer.slice(0, 400),
      retrievalUsage: {
        kind: retrieval.usageKind,
        tokens: retrieval.totalTokens,
        actualCost: retrieval.actualProviderCost,
        simulatedCost: retrieval.simulatedProviderCost,
      },
    },
    null,
    2,
  ),
);
