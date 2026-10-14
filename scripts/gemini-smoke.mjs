import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const keycloak = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const realm = process.env.KEYCLOAK_REALM || 'enterprise-ai';
const api = process.env.API_URL || 'http://localhost:3001/api';
const clientId = process.env.OIDC_CLIENT_ID || 'enterprise-ai-web';
const redirectUri = process.env.OIDC_REDIRECT_URI || 'http://localhost:3000';
const geminiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

assert(geminiKey, 'GEMINI_API_KEY is missing from the ignored .env file');

function mergeCookies(existing, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const jar = new Map(existing.split('; ').filter(Boolean).map((part) => [part.split('=')[0], part]));
  for (const value of values) {
    const cookie = value.split(';')[0];
    jar.set(cookie.split('=')[0], cookie);
  }
  return [...jar.values()].join('; ');
}

function decodeHtml(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&#x3D;', '=').replaceAll('&#61;', '=');
}

async function login(username, password) {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authUrl = new URL(`${keycloak}/realms/${realm}/protocol/openid-connect/auth`);
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })) authUrl.searchParams.set(key, value);

  const page = await fetch(authUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  let cookie = mergeCookies('', page);
  const html = await page.text();
  const action = decodeHtml(
    html.match(/<form[^>]+id="kc-form-login"[^>]+action="([^"]+)"/i)?.[1]
      || html.match(/<form[^>]+action="([^"]+)"[^>]+id="kc-form-login"/i)?.[1]
      || '',
  );
  assert(action, `Could not find Keycloak login form for ${username}`);

  const submitted = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ username, password, credentialId: '' }),
    signal: AbortSignal.timeout(10_000),
  });
  cookie = mergeCookies(cookie, submitted);
  const location = submitted.headers.get('location');
  assert(location, `Keycloak rejected demo credentials for ${username}`);
  const code = new URL(location).searchParams.get('code');
  assert(code, `Keycloak did not return an authorization code for ${username}`);

  const tokenResponse = await fetch(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(tokenResponse.status, 200, `Token exchange failed (${tokenResponse.status})`);
  const tokens = await tokenResponse.json();
  return tokens.access_token;
}

function request(path, token, init = {}) {
  return fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    signal: init.signal || AbortSignal.timeout(60_000),
  });
}

async function providerError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// Listing models validates the credential and selected endpoint without making
// a generation request. It does not reveal whether the project has billing.
const providerModelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
  headers: { 'x-goog-api-key': geminiKey },
  signal: AbortSignal.timeout(20_000),
});
if (!providerModelsResponse.ok) {
  throw new Error(`Gemini key validation failed: ${await providerError(providerModelsResponse)}`);
}
const providerModels = await providerModelsResponse.json();
const providerModel = providerModels.models?.find((item) => item.name === `models/${geminiModel}`);
assert(providerModel, `Gemini did not list ${geminiModel} for this project`);
assert(providerModel.supportedGenerationMethods?.includes('generateContent'), `${geminiModel} does not support generateContent`);

const adminToken = await login('admin', process.env.ADMIN_DEMO_PASSWORD || 'Admin123!');
const adminModelsResponse = await request('/admin/models', adminToken);
assert.equal(adminModelsResponse.status, 200, 'Could not read the model registry');
const original = (await adminModelsResponse.json()).find((model) => model.id === 'google-gemini');
assert(original, 'google-gemini is missing from the model registry');

let registryChanged = false;
try {
  if (!original.enabled) {
    const enableResponse = await request('/admin/models/google-gemini', adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enableResponse.status, 200, `Could not temporarily enable Gemini: ${await enableResponse.text()}`);
    registryChanged = true;
  }

  let selected;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request('/models', adminToken);
    assert.equal(response.status, 200, 'Could not read available models');
    selected = (await response.json()).find((model) => model.id === 'google-gemini');
    if (selected?.available) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert(selected?.available, `Gemini route is not available (${selected?.status || 'unknown status'})`);

  const createResponse = await request('/conversations', adminToken, {
    method: 'POST',
    body: JSON.stringify({ title: 'Gemini connectivity smoke test' }),
  });
  assert.equal(createResponse.status, 201, 'Could not create the smoke-test conversation');
  const conversation = await createResponse.json();
  const requestId = randomUUID();
  const streamResponse = await request(`/conversations/${conversation.id}/messages`, adminToken, {
    method: 'POST',
    body: JSON.stringify({
      content: 'Reply with exactly: GEMINI_OK',
      modelId: 'google-gemini',
      requestId,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(streamResponse.status, 200, `Gemini request failed before streaming (${streamResponse.status})`);
  const stream = await streamResponse.text();
  const errorFrame = stream.split('\n\n').find((frame) => frame.startsWith('event: error'));
  assert(!errorFrame, `Gemini generation failed: ${errorFrame?.match(/^data:\s*(.+)$/m)?.[1] || 'unknown gateway error'}`);
  const output = stream
    .split('\n\n')
    .filter((frame) => frame.startsWith('event: token'))
    .map((frame) => JSON.parse(frame.match(/^data:\s*(.+)$/m)[1]).text)
    .join('')
    .trim();
  assert(output, 'Gemini returned an empty streamed response');
  assert(stream.includes('event: done'), 'Gemini stream did not complete');

  const usageResponse = await request('/usage/me', adminToken);
  assert.equal(usageResponse.status, 200, 'Could not read usage after the Gemini request');
  const usage = await usageResponse.json();
  const record = usage.records.find((item) => item.requestId === requestId);
  assert(record, 'Gemini usage record was not persisted');
  assert.equal(record.provider, 'GEMINI');

  console.log(JSON.stringify({
    credential: 'accepted',
    model: geminiModel,
    gatewayRoute: 'google-gemini',
    response: output,
    usage: { kind: record.usageKind, inputTokens: record.inputTokens, outputTokens: record.outputTokens },
    registryRestoreScheduled: !original.enabled,
  }, null, 2));
} finally {
  if (registryChanged) {
    const restoreResponse = await request('/admin/models/google-gemini', adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    if (!restoreResponse.ok) process.stderr.write('Warning: could not restore Gemini to disabled; disable it in Admin.\n');
  }
}
