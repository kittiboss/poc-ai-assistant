// Real tenant API + Keycloak + gateway smoke test, using only the local mock model.
// Creates one test conversation and a $0.01 simulated top-up; does not change budgets/rate limits.
// Exhaustion, concurrency and isolation run in test:vendor:integration's isolated temporary DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { keycloakUrl, readEnvFile, tenantsDir } from "./lib.mjs";

const tenant = process.argv[2] || "a";
if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(tenant))
  throw new Error("Invalid tenant ID");
const env = readEnvFile(join(tenantsDir, `${tenant}.env`));
if (!env?.TENANT_ADMIN_PASSWORD)
  throw new Error(
    "Run tenant:create to provision the unique tenant administrator first",
  );
Object.assign(process.env, {
  KEYCLOAK_URL: keycloakUrl(),
  KEYCLOAK_REALM: env.KEYCLOAK_REALM,
  API_URL: `${env.API_PUBLIC_URL}/api`,
  OIDC_REDIRECT_URI: env.WEB_PUBLIC_URL,
});
const { login, request } = await import("../test-client.mjs");
const admin = await login("tenant-admin", env.TENANT_ADMIN_PASSWORD);
const json = async (path, init) => {
  const response = await request(path, admin.token, init);
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
};
const billingBefore = await json("/admin/billing");
const reference = `smoke:${randomUUID()}`;
const topup = () =>
  json("/admin/billing/topups", {
    method: "POST",
    body: JSON.stringify({ amount: "0.01", reference }),
  });
const firstReceipt = await topup(),
  duplicateReceipt = await topup();
assert.equal(firstReceipt.id, duplicateReceipt.id);
assert.equal(firstReceipt.simulation, true);
assert.ok(
  Math.abs(
    (await json("/admin/billing")).credit.limit -
      billingBefore.credit.limit -
      0.01,
  ) < 1e-8,
);

const conversation = await json("/conversations", {
  method: "POST",
  body: "{}",
});
const requestId = randomUUID();
const response = await request(
  `/conversations/${conversation.id}/messages`,
  admin.token,
  {
    method: "POST",
    body: JSON.stringify({
      requestId,
      content: "Explain Docker Compose",
      modelId: "local-mock",
    }),
  },
);
const body = await response.text();
assert.ok(
  body.includes("event: done"),
  `Mock chat failed: ${body.slice(0, 300)}`,
);
const billingAfter = await json("/admin/billing");
const metered = billingAfter.requests.find((r) => r.request_id === requestId);
assert.equal(metered?.state, "COMPLETED");
assert.ok(Number(metered.charge) > 0);
assert.ok(billingAfter.credit.spent > billingBefore.credit.spent);
assert.ok(
  !/inputCost|outputCost|markupPercent|providerInputRate|simulatedProviderCost/.test(
    JSON.stringify(billingAfter),
  ),
);
for (const path of [
  "/admin/summary",
  "/usage/me",
  "/admin/models",
  "/admin/audit",
]) {
  const payload = await json(path);
  assert.ok(
    !/"(?:actualProviderCost|simulatedProviderCost|providerInputRate|markupPercent|pricingSnapshot)"/.test(
      JSON.stringify(payload),
    ),
    `Vendor-only data exposed by ${path}`,
  );
}
const csv = await json("/workspace/usage.csv");
assert.ok(!/actualProviderCost|simulatedProviderCost/.test(csv.content));
let rag;
if (process.argv.includes("--rag")) {
  let catalog = await json("/knowledge/status");
  assert.equal(
    catalog.embeddingModel.id,
    "mock-embedding",
    "This test never calls external embedding providers",
  );
  assert.equal(catalog.embeddingModel.local, true);
  await json("/admin/knowledge/reindex", { method: "POST" });
  const deadline = Date.now() + 90000;
  do {
    assert.ok(Date.now() < deadline, "Mock indexing timed out");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    catalog = await json("/knowledge/status");
  } while (catalog.indexing);
  assert.equal(catalog.lastRun?.error ?? null, null);
  assert.equal(catalog.indexed, catalog.products);
  const ragRequest = randomUUID();
  const response = await request(
    `/conversations/${conversation.id}/messages`,
    admin.token,
    {
      method: "POST",
      body: JSON.stringify({
        requestId: ragRequest,
        modelId: "local-mock",
        content: "Which earbuds have IPX5 water resistance?",
        useProductCatalog: true,
      }),
    },
  );
  const frames = (await response.text()).split("\n\n");
  const done = frames.find((frame) => frame.startsWith("event: done"));
  assert.ok(done, "RAG chat completed");
  assert.ok(JSON.parse(done.match(/^data:\s*(.+)$/m)[1]).citations.length > 0);
  const bill = await json("/admin/billing");
  const retrieval = bill.requests.find(
    (r) => r.request_id === `${ragRequest}:retrieval`,
  );
  assert.equal(retrieval?.kind, "EMBEDDING");
  assert.ok(Number(retrieval.charge) > 0);
  assert.ok(
    bill.requests.some((r) => r.request_id === ragRequest && r.kind === "CHAT"),
  );
  rag = {
    indexedProducts: catalog.indexed,
    citations: "passed",
    chatAndEmbeddingLedger: "passed",
  };
}
const containerEnv = ["backend", "frontend", "postgres"].flatMap((service) => {
  const result = spawnSync(
    "docker",
    [
      "inspect",
      `tenant-${tenant}-${service}-1`,
      "--format",
      "{{json .Config.Env}}",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout).map((entry) => entry.split("=")[0]);
});
assert.deepEqual(
  containerEnv.filter((name) =>
    /VENDOR_ADMIN_KEY|MASTER_KEY|SALT_KEY|(GEMINI|GROQ|OPENROUTER|OPENAI|ANTHROPIC)_API_KEY/.test(
      name,
    ),
  ),
  [],
);
console.log(
  JSON.stringify(
    {
      tenant,
      mockChat: "passed",
      requestIdCorrelation: "passed",
      synchronousDebit: metered.charge,
      idempotentTestTopup: firstReceipt.id,
      customerCostRedaction: "passed",
      noProviderSecrets: "passed",
      ...(rag ? { rag } : {}),
    },
    null,
    2,
  ),
);
