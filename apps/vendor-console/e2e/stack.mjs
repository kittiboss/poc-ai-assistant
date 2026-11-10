// Global setup of the console's e2e tests. Starts a throwaway vendor-control on :4051 with its own
// Postgres container and a stub RAG engine, seeds one deployed customer, and adds a Keycloak account
// without the console role; the returned teardown removes all of it. The console (playwright.config.ts)
// must call this vendor-control and nothing else: the platform's ledger and prices are append-only.
// Needs Docker and the platform's Keycloak (npm run platform:up). Secrets are read from
// deploy/platform/.env and handed to the tests in the environment, never printed.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { keycloakAdmin, keycloakUrl, readPlatformEnv } from '../../../scripts/platform/lib.mjs';

const CONSOLE_URL = 'http://localhost:4070';
const VENDOR_CONTROL_PORT = 4051;
const VENDOR_CONTROL_URL = `http://localhost:${VENDOR_CONTROL_PORT}`;
const DB_CONTAINER = 'vendor-console-e2e-db';
const NO_ROLE_PREFIX = 'console-e2e-';
const VENDOR_CONTROL = fileURLToPath(new URL('../../vendor-control/src/server.mjs', import.meta.url));

/** The one deployed customer the read-only tests look at (ACME in fixtures.ts); tests that change things register their own. */
const SEEDED = {
  config: {
    id: 'acme',
    name: 'Acme Co',
    webPort: 3100,
    apiPort: 3101,
    initialCreditUsd: 2,
    models: ['local-mock', 'mock-embedding', 'google-gemini'],
    dailyExternalLimits: { requests: 33, tokens: 33333 },
    embeddingBatch: { size: 8, intervalMs: 15500 },
  },
  key: 'sk-acme-console-e2e-only-0000',
  openingCredit: 2,
};
/** What the stub RAG engine reports for it. */
const RAG_USAGE = { tenants: [{ tenant: 'acme', documents: 3, textBytes: 1_572_864, chunks: 120 }] };

const secret = () => randomBytes(24).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reachable = (url) =>
  fetch(url).then(
    () => true,
    () => false,
  );

async function until(what, ready, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    if (await ready().catch(() => false)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`${what} did not become ready`);
    await sleep(500);
  }
}

async function removeTestAccounts(platform) {
  const admin = await keycloakAdmin(platform);
  const users = await (await admin(`/realms/vendor/users?search=${NO_ROLE_PREFIX}`)).json();
  for (const user of users.filter((u) => u.username.startsWith(NO_ROLE_PREFIX)))
    await admin(`/realms/vendor/users/${user.id}`, { method: 'DELETE' });
}

export default async function globalSetup() {
  const platform = readPlatformEnv();
  const keycloak = keycloakUrl(platform);
  if (!(await reachable(`${keycloak}/realms/vendor/.well-known/openid-configuration`)))
    throw new Error(`The vendor realm at ${keycloak} cannot be reached: start the platform (npm run platform:up).`);

  // The console under test must call the throwaway vendor-control, or the tests would write to the platform.
  const page = await (await fetch(`${CONSOLE_URL}/tenants`)).text();
  const config = JSON.parse(/__CONSOLE_CONFIG__=(\{.*?\});/.exec(page)?.[1] ?? '{}');
  if (config.vendorControlUrl !== VENDOR_CONTROL_URL || config.keycloakUrl !== keycloak)
    throw new Error(
      `The console on ${CONSOLE_URL} calls ${config.vendorControlUrl} and ${config.keycloakUrl}, not ${VENDOR_CONTROL_URL} and ${keycloak}.`,
    );
  if (await reachable(`${VENDOR_CONTROL_URL}/health/readiness`))
    throw new Error(`Port ${VENDOR_CONTROL_PORT} is in use; the tests start their own vendor-control there.`);

  // Leftovers of a run that was killed before its teardown.
  try {
    docker('rm', '-f', DB_CONTAINER);
  } catch {}
  await removeTestAccounts(platform);

  let vendorControl;
  let rag;
  const teardown = async () => {
    vendorControl?.kill();
    rag?.close();
    try {
      docker('rm', '-f', DB_CONTAINER);
    } catch {}
    await removeTestAccounts(platform);
  };

  try {
    const dbPassword = secret();
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      DB_CONTAINER,
      '-e',
      `POSTGRES_PASSWORD=${dbPassword}`,
      '-p',
      '127.0.0.1::5432',
      'postgres:17-alpine',
    );
    // Over TCP: the image's first-boot server only listens on its socket.
    await until('Postgres', async () => {
      docker('exec', DB_CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
      return true;
    });
    const dbPort = docker('port', DB_CONTAINER, '5432/tcp').split('\n')[0].split(':').pop();

    rag = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.method === 'GET' ? RAG_USAGE : { deleted: true }));
    });
    await new Promise((resolve) => rag.listen(0, '127.0.0.1', resolve));

    const adminKey = secret();
    let exited = false;
    vendorControl = spawn(process.execPath, [VENDOR_CONTROL], {
      env: {
        ...process.env,
        PORT: String(VENDOR_CONTROL_PORT),
        DATABASE_URL: `postgresql://postgres:${dbPassword}@127.0.0.1:${dbPort}/postgres`,
        VENDOR_ADMIN_KEY: adminKey,
        // No model is called: the tests only use the admin API.
        UPSTREAM_URL: 'http://127.0.0.1:9',
        RAG_ENGINE_URL: `http://127.0.0.1:${rag.address().port}`,
        RAG_ADMIN_KEY: 'e2e-rag-stub',
        KEYCLOAK_URL: keycloak,
        KEYCLOAK_INTERNAL_URL: keycloak,
        VENDOR_REALM: 'vendor',
        VENDOR_CONSOLE_ORIGIN: CONSOLE_URL,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    vendorControl.on('exit', () => (exited = true));
    await until('vendor-control', async () => {
      if (exited) throw new Error('vendor-control exited');
      return (await fetch(`${VENDOR_CONTROL_URL}/health/readiness`)).ok;
    });

    const seeded = await fetch(`${VENDOR_CONTROL_URL}/admin/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(SEEDED),
    });
    if (!seeded.ok) throw new Error(`Seeding ${SEEDED.config.id} failed (${seeded.status})`);

    // Signs in but may not use the console.
    const noRole = { username: `${NO_ROLE_PREFIX}${randomBytes(4).toString('hex')}`, password: secret() };
    const admin = await keycloakAdmin(platform);
    const created = await admin('/realms/vendor/users', {
      method: 'POST',
      body: {
        username: noRole.username,
        enabled: true,
        firstName: 'No',
        lastName: 'Role',
        email: `${noRole.username}@vendor.example.test`,
        emailVerified: true,
        credentials: [{ type: 'password', value: noRole.password, temporary: false }],
      },
    });
    if (!created.ok) throw new Error(`Creating ${noRole.username} failed (${created.status})`);

    Object.assign(process.env, {
      E2E_VENDOR_CONTROL_URL: VENDOR_CONTROL_URL,
      E2E_ADMIN_KEY: adminKey,
      E2E_DB_CONTAINER: DB_CONTAINER,
      E2E_KEYCLOAK_URL: keycloak,
      E2E_STAFF_USERNAME: 'vendor-admin',
      E2E_STAFF_PASSWORD: platform.VENDOR_CONSOLE_PASSWORD,
      E2E_NO_ROLE_USERNAME: noRole.username,
      E2E_NO_ROLE_PASSWORD: noRole.password,
    });
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
