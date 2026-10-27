// Shared helpers for the vendor platform scripts (Node built-ins only).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const platformDir = join(root, 'deploy', 'platform');
export const platformEnvFile = join(platformDir, '.env');
export const tenantsDir = join(root, 'deploy', 'tenants');
export const tenantComposeFile = join(root, 'deploy', 'tenant', 'docker-compose.yml');
export const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:4000';
export const vendorUrl = process.env.VENDOR_URL || 'http://127.0.0.1:4050';

export async function vendor(path, { method = 'GET', body, key = readPlatformEnv().VENDOR_ADMIN_KEY } = {}) {
  const response = await fetch(`${vendorUrl}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Vendor service ${method} ${path} failed (${response.status})`);
  return response.json();
}

/** Platform models served through each credential proxy; a customer key only lists models whose proxy can run. */
export const providerModels = {
  GEMINI_API_KEY: { profile: 'gemini', models: ['google-gemini', 'gemini-embedding'] },
  GROQ_API_KEY: { profile: 'groq', models: ['groq-llama'] },
  OPENROUTER_API_KEY: { profile: 'openrouter', models: ['openrouter-free'] },
};

/** KEY=value lines; blank lines and # comments are ignored. */
export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

export const readEnvFile = (file) => (existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : undefined);

/** Secrets only: readable by the owner alone. */
export function writeEnvFile(file, values, header) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(file, `${header ? `# ${header}\n` : ''}${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function readPlatformEnv() {
  const env = readEnvFile(platformEnvFile);
  if (!env) throw new Error('deploy/platform/.env is missing: run npm run platform:up first');
  return env;
}

export const secret = (bytes = 24) => randomBytes(bytes).toString('hex');

/** The provider profiles to start: one per provider key present in the platform's env. */
export const platformProfiles = (env) =>
  Object.entries(providerModels)
    .filter(([key]) => env[key]?.trim())
    .map(([, { profile }]) => profile);

export function run(command, args, { cwd = root, capture = false } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})${detail}`);
  }
  return result.stdout;
}

export const platformCompose = (args, env = readPlatformEnv(), options) =>
  run(
    'docker',
    ['compose', '--env-file', platformEnvFile, ...platformProfiles(env).flatMap((profile) => ['--profile', profile]), ...args],
    { cwd: platformDir, ...options },
  );

export const tenantCompose = (id, args, options) =>
  run(
    'docker',
    ['compose', '-p', `tenant-${id}`, '--env-file', join(tenantsDir, `${id}.env`), '-f', tenantComposeFile, ...args],
    options,
  );

export async function waitHealthy(containers, timeoutMs = 300_000) {
  const started = Date.now();
  for (const container of containers) {
    for (;;) {
      const result = spawnSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', container], { encoding: 'utf8' });
      if (result.stdout.trim() === 'healthy') break;
      if (Date.now() - started > timeoutMs) throw new Error(`${container} did not become healthy`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

/** The gateway's admin API, called with the platform master key. */
export async function gateway(path, { method = 'GET', body, key = readPlatformEnv().LITELLM_MASTER_KEY } = {}) {
  const response = await fetch(`${gatewayUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`gateway ${method} ${path.split('?')[0]} failed (${response.status})`);
  return text ? JSON.parse(text) : undefined;
}

export const keycloakUrl = (env = readPlatformEnv()) => `http://localhost:${env.KEYCLOAK_PORT || 8180}`;

/** Keycloak's admin REST API, signed in to the master realm as the platform admin. */
export async function keycloakAdmin(env = readPlatformEnv()) {
  const base = keycloakUrl(env);
  const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: env.KEYCLOAK_ADMIN || 'admin',
      password: env.KEYCLOAK_ADMIN_PASSWORD,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Keycloak admin sign-in failed (${tokenResponse.status})`);
  const { access_token: token } = await tokenResponse.json();
  return (path, { method = 'GET', body } = {}) =>
    fetch(`${base}/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
}
