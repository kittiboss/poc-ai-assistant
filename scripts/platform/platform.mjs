// Vendor platform lifecycle: `npm run platform:build | platform:up | platform:down`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  keycloakUrl,
  platformCompose,
  platformEnvFile,
  platformProfiles,
  providerModels,
  readEnvFile,
  root,
  run,
  secret,
  waitHealthy,
  writeEnvFile,
} from './lib.mjs';

const [command, ...flags] = process.argv.slice(2);

/** Provider settings the single-installation stack keeps in the root .env; the platform takes them over once. */
const importedSettings = [...Object.keys(providerModels), 'GROQ_FREE_TIER_CONFIRMED', 'GEMINI_MODEL', 'GEMINI_EMBEDDING_MODEL', 'GROQ_MODEL'];

const laterSecrets = () => ({
  VENDOR_ADMIN_KEY: secret(32),
  RAG_DB_PASSWORD: secret(16),
  RAG_APP_DB_PASSWORD: secret(16),
  RAG_ADMIN_KEY: secret(32),
});

function ensurePlatformEnv() {
  const existing = readEnvFile(platformEnvFile);
  if (existing) {
    // Secrets added by later platform versions; existing ones are never regenerated.
    const added = Object.entries(laterSecrets()).filter(([key]) => !existing[key]);
    if (added.length) {
      Object.assign(existing, Object.fromEntries(added));
      writeEnvFile(platformEnvFile, existing, 'Vendor platform secrets. Never commit this file.');
      console.log(`Added ${added.map(([key]) => key).join(', ')} to deploy/platform/.env.`);
    }
    return existing;
  }
  const fromRoot = readEnvFile(join(root, '.env')) ?? {};
  const imported = Object.fromEntries(importedSettings.filter((key) => fromRoot[key]?.trim()).map((key) => [key, fromRoot[key]]));
  const env = {
    // LiteLLM requires keys that start with sk-.
    LITELLM_MASTER_KEY: `sk-${secret()}`,
    LITELLM_SALT_KEY: `sk-${secret()}`,
    GATEWAY_DB_PASSWORD: secret(16),
    KEYCLOAK_ADMIN_PASSWORD: secret(12),
    KEYCLOAK_PORT: '8180',
    ...laterSecrets(),
    ...imported,
  };
  writeEnvFile(platformEnvFile, env, 'Vendor platform secrets. Never commit this file. Provider keys enable their credential proxy.');
  console.log(`Created deploy/platform/.env with new secrets${Object.keys(imported).length ? ` and ${Object.keys(imported).join(', ')} from .env` : ''}.`);
  return env;
}

const running = (name) =>
  spawnSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim() !== '';

if (command === 'build') {
  // Next.js needs ~2 GB to build; on a small Docker VM that only fits while the platform is stopped.
  if (!flags.includes('--force') && ['platform-keycloak-1', 'platform-litellm-1'].some(running)) {
    console.error('Stop the platform first (npm run platform:down) so the image builds have enough memory, or pass --force.');
    process.exit(1);
  }
  run('docker', ['build', '-t', 'enterprise-ai/postgres:local', 'infra/postgres']);
  run('docker', ['build', '-t', 'enterprise-ai/api:local', '-f', 'apps/api/Dockerfile', '.']);
  // One web image for every customer: API and sign-in settings arrive at runtime.
  run('docker', ['build', '-t', 'enterprise-ai/web:local', '-f', 'apps/web/Dockerfile', '.']);
  platformCompose(['--profile', 'gemini', '--profile', 'groq', '--profile', 'openrouter', 'build'], ensurePlatformEnv());
} else if (command === 'up') {
  const env = ensurePlatformEnv();
  platformCompose(['up', '-d'], env);
  await waitHealthy(['platform-keycloak-1', 'platform-litellm-1', 'platform-vendor-control-1', 'platform-rag-engine-1']);
  const profiles = platformProfiles(env);
  console.log(`Platform is up. Keycloak: ${keycloakUrl(env)} · gateway admin API: http://127.0.0.1:4000`);
  console.log(`Provider proxies: ${profiles.length ? profiles.join(', ') : 'none (add a provider key to deploy/platform/.env)'}`);
  console.log('Vendor console: http://localhost:4050/console/ · username vendor · password VENDOR_ADMIN_KEY in deploy/platform/.env');
} else if (command === 'down') {
  platformCompose(['down'], readEnvFile(platformEnvFile) ?? {});
} else {
  console.error('Usage: node scripts/platform/platform.mjs build [--force] | up | down');
  process.exit(1);
}
