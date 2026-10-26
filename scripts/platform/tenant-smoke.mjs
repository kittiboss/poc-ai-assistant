// Real tenant API + Keycloak + gateway smoke test, using only the local mock model.
// Creates one test conversation and a $0.01 simulated top-up; does not change budgets/rate limits.
// Exhaustion, concurrency and isolation run in test:vendor:integration's isolated temporary DB.
// --rag [--with <id>]: the central knowledge base, with a second customer (default b, or a) to
// prove each one only retrieves its own documents. Mock embeddings only; uploads are removed after.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { keycloakUrl, readEnvFile, tenantsDir, vendor } from "./lib.mjs";

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
if (process.argv.includes("--rag")) rag = await centralKnowledge();
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

/** Signs in as another customer's tenant-admin; test-client reads its target when imported. */
async function customer(id) {
  const tenantEnv = readEnvFile(join(tenantsDir, `${id}.env`));
  if (!tenantEnv?.TENANT_ADMIN_PASSWORD) return null;
  Object.assign(process.env, {
    KEYCLOAK_URL: keycloakUrl(),
    KEYCLOAK_REALM: tenantEnv.KEYCLOAK_REALM,
    API_URL: `${tenantEnv.API_PUBLIC_URL}/api`,
    OIDC_REDIRECT_URI: tenantEnv.WEB_PUBLIC_URL,
  });
  const client = await import(`../test-client.mjs?tenant=${id}`);
  const signIn = async () => (await client.login("tenant-admin", tenantEnv.TENANT_ADMIN_PASSWORD)).token;
  let token = await signIn();
  const send = (path, init) =>
    fetch(`${tenantEnv.API_PUBLIC_URL}/api${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      },
    });
  const call = async (path, init = {}) => {
    let response = await send(path, init);
    // Indexing and limit propagation waits can outlast an access token; sign in again once.
    if (response.status === 401) {
      token = await signIn();
      response = await send(path, init);
    }
    const text = await response.text();
    assert.ok(response.ok, `${id} ${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return text.startsWith("event:") ? text : text ? JSON.parse(text) : undefined;
  };
  return { id, call };
}

/** A one-page PDF with real text, so the tenant's PDF extraction runs as it does for uploads. */
function pdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function centralKnowledge() {
  const withIndex = process.argv.indexOf("--with");
  const otherId = withIndex > 0 ? process.argv[withIndex + 1] : tenant === "b" ? "a" : "b";
  const self = await customer(tenant);
  const other = await customer(otherId);
  assert.ok(other, `Create customer ${otherId} too (npm run tenant:create -- ${otherId}) to check isolation`);
  const parties = [self, other].map((party, i) => ({
    ...party,
    days: i === 0 ? 45 : 10,
    marker: `${party.id.toUpperCase()}${randomUUID().slice(0, 8)}`,
    uploaded: [],
  }));
  const overview = (party) => party.call("/admin/knowledge/settings");
  // Waits count attempts, not wall time, so a laptop that sleeps mid-run does not fail them.
  const poll = async (what, attempts, intervalMs, done) => {
    for (let attempt = 0; ; attempt++) {
      const value = await done();
      if (value) return value;
      assert.ok(attempt < attempts, `${what} timed out`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };
  const waitIndexed = (party, check = () => true) =>
    poll(`${party.id}: indexing`, 120, 1000, async () => {
      const current = await overview(party);
      assert.ok(!current.usage.pausedDocuments, `${party.id}: indexing paused`);
      return !current.usage.pendingChunks && current.active?.version === current.target.version && check(current)
        ? current
        : null;
    });
  const ask = async (party, question) => {
    const conversation = await party.call("/conversations", { method: "POST", body: "{}" });
    const requestId = randomUUID();
    const stream = await party.call(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ requestId, modelId: "local-mock", content: question, useKnowledge: true }),
    });
    const done = stream.split("\n\n").find((frame) => frame.startsWith("event: done"));
    assert.ok(done, `${party.id}: knowledge chat failed: ${stream.slice(0, 300)}`);
    return { requestId, citations: JSON.parse(done.match(/^data:\s*(.+)$/m)[1]).citations };
  };
  const limits = new Map((await vendor("/admin/tenants")).map((t) => [t.id, t.rag]));
  try {
    for (const party of parties) {
      const current = await overview(party);
      // Never call an external embedding provider from a test.
      assert.equal(current.settings.embeddingModel, "mock-embedding", `${party.id} must use mock-embedding`);
      assert.ok(!current.active || current.active.model === "mock-embedding");
      const fact = `${party.id.toUpperCase()} refund policy: the refund window is ${party.days} days. Code word ${party.marker}.`;
      const files = [
        ["refunds.txt", Buffer.from(fact)],
        ["refunds.md", Buffer.from(`# Refunds\n\n${fact}\n\nShipping takes 3 business days.`)],
        ["refunds.pdf", pdf(fact)],
        ["policies.csv", Buffer.from(`name,policy\nRefund window,"${fact}"\nWarranty,Two years for every product.`)],
      ];
      for (const [name, bytes] of files) {
        const form = new FormData();
        form.append("file", new Blob([bytes]), name);
        party.uploaded.push((await party.call("/admin/knowledge/documents", { method: "POST", body: form })).id);
      }
    }
    for (const party of parties) await waitIndexed(party);

    const answers = {};
    for (const party of parties) {
      const { requestId, citations } = await ask(party, "What is the refund window?");
      const others = parties.filter((p) => p !== party);
      assert.ok(citations.length > 0, `${party.id}: no citations`);
      for (const citation of citations) {
        assert.equal(citation.kind, "document");
        const documentId = citation.sourceId.replace("document:", "");
        assert.ok(!others.some((o) => o.uploaded.includes(documentId)), `${party.id} cited another customer's document`);
        for (const o of others) assert.ok(!citation.content.includes(o.marker), `${party.id} received ${o.id}'s text`);
      }
      assert.ok(citations.some((c) => c.content.includes(party.marker)), `${party.id}: own document not cited`);
      assert.ok(citations.some((c) => c.page === 1 && c.filename.startsWith("refunds.pdf")), `${party.id}: PDF page not cited`);
      const bill = await party.call("/admin/billing");
      assert.equal(bill.requests.find((r) => r.request_id === `${requestId}:retrieval`)?.kind, "EMBEDDING");
      assert.ok(bill.requests.some((r) => r.request_id.startsWith("rag-index:") && r.kind === "EMBEDDING"));
      answers[party.id] = citations.length;
    }

    // The vendor lowers the top-K limit: the customer's own setting is clamped (engine cache ≤ 30 s).
    await vendor(`/admin/tenants/${self.id}/rag`, { method: "PATCH", body: { maxTopK: 1 } });
    await poll("the lowered top-K limit", 25, 2000, async () => (await overview(self)).effective.topK === 1);
    assert.ok((await ask(self, "What is the refund window?")).citations.length <= 1);
    await vendor(`/admin/tenants/${self.id}/rag`, { method: "PATCH", body: { maxTopK: limits.get(self.id).maxTopK } });
    await poll(
      "the restored top-K limit",
      25,
      2000,
      async () => (await overview(self)).limits.maxTopK === limits.get(self.id).maxTopK,
    );

    // A chunking change builds a new index version; search switches when it is complete.
    const before = await overview(self);
    const original = { chunkSize: before.settings.chunkSize, chunkOverlap: before.settings.chunkOverlap };
    const changed = await self.call("/admin/knowledge/settings", {
      method: "PATCH",
      body: JSON.stringify({ chunkSize: 600, chunkOverlap: 100 }),
    });
    assert.equal(changed.reindex, true);
    const rebuilt = await waitIndexed(self, (current) => current.active.version > before.active.version);
    assert.ok((await ask(self, "What is the refund window?")).citations.length > 0);
    await self.call("/admin/knowledge/settings", { method: "PATCH", body: JSON.stringify(original) });
    await waitIndexed(self, (current) => current.active.version > rebuilt.active.version);

    return {
      documentsPerCustomer: 4,
      isolation: `${self.id} and ${other.id} cite only their own documents`,
      citations: answers,
      pdfPageCited: "passed",
      vendorTopKClamp: "passed",
      versionSwitch: `${before.active.version} → ${rebuilt.active.version}`,
      embeddingLedger: "passed",
    };
  } finally {
    await vendor(`/admin/tenants/${self.id}/rag`, { method: "PATCH", body: { maxTopK: limits.get(self.id).maxTopK } }).catch(() => undefined);
    for (const party of parties)
      for (const id of party.uploaded)
        await party.call(`/admin/knowledge/documents/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
