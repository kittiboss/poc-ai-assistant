import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_ROLES } from './auth';
import { AdminController } from './controllers';

const root = resolve(process.cwd(), '../..');

describe('security and provider configuration', () => {
  it('configures Keycloak authorization code + PKCE, audience, roles, and demo users', () => {
    const realm = JSON.parse(readFileSync(resolve(root, 'infra/keycloak/enterprise-ai-realm.json'), 'utf8'));
    const web = realm.clients.find((client: { clientId: string }) => client.clientId === 'enterprise-ai-web');
    expect(web.publicClient).toBe(true);
    expect(web.standardFlowEnabled).toBe(true);
    expect(web.directAccessGrantsEnabled).toBe(false);
    expect(web.attributes['pkce.code.challenge.method']).toBe('S256');
    expect(web.protocolMappers[0].config['included.client.audience']).toBe('enterprise-ai-api');
    expect(realm.users.map((user: { username: string }) => user.username)).toEqual(['admin', 'employee1', 'employee2']);
    expect(realm.roles.realm.map((role: { name: string }) => role.name)).toEqual(['ADMIN', 'USER']);
  });

  it('keeps external providers out of the default LiteLLM routes', () => {
    const config = readFileSync(resolve(root, 'infra/litellm/config.yaml'), 'utf8');
    expect(config).toContain('model_name: local-mock');
    expect(config).not.toMatch(/model_name:\s*(openai-gpt|anthropic-claude|google-gemini)/);
  });

  it('requires a separate Compose overlay and environment-only secret for Gemini', () => {
    const config = readFileSync(resolve(root, 'infra/litellm/config.gemini.yaml'), 'utf8');
    const overlay = readFileSync(resolve(root, 'docker-compose.gemini.yml'), 'utf8');
    expect(config).toContain('model_name: google-gemini');
    expect(config).toContain('api_key: local-gemini-proxy');
    expect(config).not.toContain('api_key: os.environ/GEMINI_API_KEY');
    expect(overlay).toContain('gemini-proxy:');
    expect(overlay).toMatch(/GEMINI_API_KEY:\s*\$\{GEMINI_API_KEY:\?/);
    // The overlay does not flip the global switch itself; the operator must set it explicitly in .env.
    expect(overlay).toContain('ENABLE_EXTERNAL_PROVIDERS: ${ENABLE_EXTERNAL_PROVIDERS:-false}');
    expect(overlay).not.toMatch(/ENABLE_EXTERNAL_PROVIDERS:\s*"?true/);
    // Only the credential proxy may reach the internet; LiteLLM stays on the internal network.
    const litellm = overlay.slice(overlay.indexOf('\n  litellm:'), overlay.indexOf('\n  backend:'));
    expect(litellm).not.toContain('edge');
  });

  it('makes Ollama opt-in and protects every admin endpoint with ADMIN', () => {
    const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/ollama:\n[\s\S]*?profiles: \["ollama"\]/);
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminController)).toEqual(['ADMIN']);
  });
});

