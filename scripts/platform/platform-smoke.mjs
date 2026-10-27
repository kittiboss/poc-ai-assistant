// Checks the vendor gateway's contract that customer deployments rely on: per-customer virtual keys,
// model allowlists, prepaid budgets, rate limits, and that a customer key cannot manage keys.
// Uses only the free mock routes. Run with the platform up: `npm run platform:smoke`.
import assert from 'node:assert/strict';
import { readPlatformEnv } from './lib.mjs';

const gateway = process.env.GATEWAY_URL || 'http://127.0.0.1:4000';
const master = readPlatformEnv().LITELLM_MASTER_KEY;
const created = [];

async function call(path, { key, method = 'GET', body } = {}) {
  const response = await fetch(`${gateway}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, text };
}

async function newKey(settings) {
  const { status, json } = await call('/key/generate', {
    key: master,
    method: 'POST',
    body: { key_alias: `smoke-${Date.now()}-${created.length}`, ...settings },
  });
  assert.equal(status, 200, `key/generate failed: ${JSON.stringify(json)}`);
  created.push(json.key);
  return json.key;
}

const chat = (key, model = 'local-mock') =>
  call('/v1/chat/completions', {
    key,
    method: 'POST',
    body: { model, messages: [{ role: 'user', content: 'Explain Docker Compose' }], max_tokens: 32 },
  });
const embed = (key) =>
  call('/v1/embeddings', { key, method: 'POST', body: { model: 'mock-embedding', input: ['credit check'] } });

// Spend is written to the database in batches, so poll the key's own info until it moves.
async function waitForSpend(key, above, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { json } = await call('/key/info', { key });
    const spend = json?.info?.spend ?? 0;
    if (spend > above) return spend;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`spend did not rise above ${above} within ${timeoutMs / 1000}s`);
}

const results = {};
try {
  const key = await newKey({ models: ['local-mock', 'mock-embedding'], max_budget: 1 });

  const models = await call('/v1/models', { key });
  assert.equal(models.status, 200);
  assert.deepEqual(models.json.data.map((m) => m.id).sort(), ['local-mock', 'mock-embedding']);
  results.modelAllowlist = 'passed';

  const info = await call('/key/info', { key });
  assert.equal(info.status, 200, `a key must be able to read its own info: ${info.text}`);
  assert.equal(info.json.info.max_budget, 1);
  results.ownKeyInfo = 'passed';

  for (const [path, method, body] of [
    ['/key/update', 'POST', { key, max_budget: 1000 }],
    ['/key/generate', 'POST', { models: ['local-mock'] }],
    ['/key/list', 'GET'],
    ['/spend/logs', 'GET'],
  ]) {
    const denied = await call(path, { key, method, body });
    assert.ok([401, 403].includes(denied.status), `${path} must be refused for a customer key, got ${denied.status}`);
  }
  results.customerKeyCannotManageKeys = 'passed';

  assert.equal((await chat(key)).status, 200);
  const chatSpend = await waitForSpend(key, 0);
  assert.equal((await embed(key)).status, 200);
  const totalSpend = await waitForSpend(key, chatSpend);
  results.spendFromMockPrices = { chat: chatSpend, chatPlusEmbedding: totalSpend };

  // The API maps these error types to its own codes (apps/api/src/gateway/gateway.service.ts).
  const denied = await chat(await newKey({ models: ['mock-embedding'], max_budget: 1 }));
  assert.equal(denied.status, 401);
  assert.equal(denied.json.error.type, 'key_model_access_denied');
  results.modelNotInAllowlist = 'passed';

  const tiny = await newKey({ models: ['local-mock'], max_budget: 0.0000001 });
  assert.equal((await chat(tiny)).status, 200);
  await waitForSpend(tiny, 0.0000001);
  const over = await chat(tiny);
  assert.equal(over.status, 400);
  assert.equal(over.json.error.type, 'budget_exceeded');
  // Once the budget is spent the gateway refuses /v1/models too; the key's own info still answers.
  const modelsWhenSpent = await call('/v1/models', { key: tiny });
  assert.equal(modelsWhenSpent.json?.error?.type, 'budget_exceeded');
  const infoWhenSpent = await call('/key/info', { key: tiny });
  assert.equal(infoWhenSpent.status, 200);
  assert.deepEqual(infoWhenSpent.json.info.models, ['local-mock']);
  results.budgetExceeded = 'passed';

  // A per-model limit applies to that model only, so a customer's share of one provider
  // does not throttle its other models.
  const limited = await newKey({
    models: ['local-mock', 'mock-embedding'],
    max_budget: 1,
    model_rpm_limit: { 'local-mock': 1 },
  });
  assert.equal((await chat(limited)).status, 200);
  assert.equal((await chat(limited)).status, 429);
  assert.equal((await embed(limited)).status, 200);
  results.perModelRateLimit = 'passed';

  console.log(JSON.stringify(results, null, 2));
} finally {
  if (created.length) await call('/key/delete', { key: master, method: 'POST', body: { keys: created } });
}
