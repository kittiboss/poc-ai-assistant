import type { Provider } from '@prisma/client';

export const EXTERNAL_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GEMINI'] as const;

export function isExternalProvider(provider: Provider | string) {
  return (EXTERNAL_PROVIDERS as readonly string[]).includes(provider);
}

/** An API key alone is never enough: external use also needs the explicit global switch. */
export function externalProviderAllowed(provider: Provider | string, enabled: boolean, credential?: string) {
  return !isExternalProvider(provider) || (enabled && Boolean(credential?.trim()));
}

export function credentialFor(provider: Provider | string, env: NodeJS.ProcessEnv = process.env) {
  return provider === 'OPENAI' ? env.OPENAI_API_KEY : provider === 'ANTHROPIC' ? env.ANTHROPIC_API_KEY : provider === 'GEMINI' ? env.GEMINI_API_KEY : 'local';
}

export function modelAllowedForUser(allowedRoles: string[], userRoles: string[], explicit?: boolean) {
  if (explicit !== undefined) return explicit;
  return allowedRoles.some((role) => userRoles.includes(role));
}
