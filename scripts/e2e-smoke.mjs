import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const keycloak = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const realm = process.env.KEYCLOAK_REALM || 'enterprise-ai';
const api = process.env.API_URL || 'http://localhost:3001/api';
const clientId = process.env.OIDC_CLIENT_ID || 'enterprise-ai-web';
const redirectUri = process.env.OIDC_REDIRECT_URI || 'http://localhost:3000';

function mergeCookies(existing, response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
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
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email', code_challenge: challenge, code_challenge_method: 'S256' })) authUrl.searchParams.set(key, value);

  const page = await fetch(authUrl, { redirect: 'manual' });
  let cookie = mergeCookies('', page);
  const html = await page.text();
  const action = decodeHtml(html.match(/<form[^>]+id="kc-form-login"[^>]+action="([^"]+)"/i)?.[1] || html.match(/<form[^>]+action="([^"]+)"[^>]+id="kc-form-login"/i)?.[1] || '');
  assert(action, `Could not find Keycloak login form for ${username}`);

  const submitted = await fetch(action, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  cookie = mergeCookies(cookie, submitted);
  const location = submitted.headers.get('location');
  assert(location, `Keycloak rejected demo credentials for ${username}`);
  const code = new URL(location).searchParams.get('code');
  assert(code, `Keycloak did not return an authorization code for ${username}`);

  const tokenResponse = await fetch(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier }),
  });
  if (tokenResponse.status !== 200) throw new Error(`Token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
  const tokens = await tokenResponse.json();
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.iss, `${keycloak}/realms/${realm}`);
  assert(Array.isArray(claims.aud) ? claims.aud.includes('enterprise-ai-api') : claims.aud === 'enterprise-ai-api');
  return { token: tokens.access_token, claims };
}

async function request(path, token, init = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers } });
  return response;
}

const employee1 = await login('employee1', process.env.EMPLOYEE_DEMO_PASSWORD || 'Employee123!');
const employee2 = await login('employee2', process.env.EMPLOYEE_DEMO_PASSWORD || 'Employee123!');
const admin = await login('admin', process.env.ADMIN_DEMO_PASSWORD || 'Admin123!');
assert(employee1.claims.realm_access.roles.includes('USER'));
assert(admin.claims.realm_access.roles.includes('ADMIN'));

const modelResponse = await request('/models', employee1.token);
assert.equal(modelResponse.status, 200);
const models = await modelResponse.json();
assert.equal(models.find((model) => model.id === 'local-mock').available, true);
assert.equal(models.find((model) => model.id === 'qwen-local').enabled, false);

const createResponse = await request('/conversations', employee1.token, { method: 'POST', body: JSON.stringify({ title: 'E2E mock verification' }) });
assert.equal(createResponse.status, 201);
const conversation = await createResponse.json();

const streamResponse = await request(`/conversations/${conversation.id}/messages`, employee1.token, {
  method: 'POST', body: JSON.stringify({ content: 'Explain Docker Compose', modelId: 'local-mock', requestId: randomUUID() }),
});
assert.equal(streamResponse.status, 200);
const stream = await streamResponse.text();
const output = stream.split('\n\n').filter((frame) => frame.startsWith('event: token')).map((frame) => JSON.parse(frame.match(/^data:\s*(.+)$/m)[1]).text).join('');
assert.equal(output, 'This is a mock AI response for local POC testing.');
assert(stream.includes('event: done'));

const persistedResponse = await request(`/conversations/${conversation.id}`, employee1.token);
assert.equal(persistedResponse.status, 200);
const persisted = await persistedResponse.json();
assert.equal(persisted.messages.at(-1).status, 'COMPLETED');
assert.equal(persisted.messages.at(-1).content, output);

const forbiddenOwnership = await request(`/conversations/${conversation.id}`, employee2.token);
assert.equal(forbiddenOwnership.status, 404);
const forbiddenAdmin = await request('/admin/summary', employee1.token);
assert.equal(forbiddenAdmin.status, 403);
const adminSummary = await request('/admin/summary', admin.token);
assert.equal(adminSummary.status, 200);

const usageResponse = await request('/usage/me', employee1.token);
assert.equal(usageResponse.status, 200);
const usage = await usageResponse.json();
const record = usage.records.find((item) => item.conversationId === conversation.id);
assert(record);
assert.equal(record.usageKind, 'SYNTHETIC');
assert.equal(Number(record.actualProviderCost), 0);

console.log(JSON.stringify({
  oidc: 'authorization-code-pkce',
  authenticatedUsers: ['employee1', 'employee2', 'admin'],
  ownershipIsolation: 'passed', adminRbac: 'passed',
  gatewayModel: 'local-mock', streamedResponse: output,
  usage: { kind: record.usageKind, totalTokens: record.totalTokens, actualProviderCost: record.actualProviderCost },
}, null, 2));
