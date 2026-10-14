import type { Provider } from '@prisma/client';

export function isExternalProvider(provider: Provider | string) {
  return ['OPENAI', 'ANTHROPIC', 'GEMINI'].includes(provider);
}

export function externalProviderAllowed(provider: Provider | string, enabled: boolean, credential?: string) {
  return !isExternalProvider(provider) || (enabled && Boolean(credential?.trim()));
}

export function modelAllowedForUser(allowedRoles: string[], userRoles: string[], explicit?: boolean) {
  if (explicit !== undefined) return explicit;
  return allowedRoles.some((role) => userRoles.includes(role));
}

