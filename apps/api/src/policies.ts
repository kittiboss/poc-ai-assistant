import type { Provider } from '@prisma/client';
import type { GatewayMessage } from './gateway.service';

export const EXTERNAL_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GEMINI'] as const;

export function isExternalProvider(provider: Provider | string) {
  return (EXTERNAL_PROVIDERS as readonly string[]).includes(provider);
}

export function externalProviderAllowed(provider: Provider | string, enabled: boolean, credential?: string) {
  return !isExternalProvider(provider) || (enabled && Boolean(credential?.trim()));
}

export function modelAllowedForUser(allowedRoles: string[], userRoles: string[], explicit?: boolean) {
  if (explicit !== undefined) return explicit;
  return allowedRoles.some((role) => userRoles.includes(role));
}

export type ExternalLimits = { requests: number; tokens: number };

/** Installation-wide daily ceiling for every external provider. 0 blocks external use entirely. */
export function externalDailyLimits(env: NodeJS.ProcessEnv = process.env): ExternalLimits {
  const parse = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return { requests: parse(env.EXTERNAL_DAILY_REQUEST_LIMIT, 100), tokens: parse(env.EXTERNAL_DAILY_TOKEN_LIMIT, 100_000) };
}

export function externalBudgetExhausted(used: { requests: number; tokens: number }, limits: ExternalLimits) {
  return used.requests >= limits.requests || used.tokens >= limits.tokens;
}

export function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Failed and empty turns are kept for the user's history but never replayed to a
 * provider: several providers (Gemini included) reject empty content parts.
 */
export function toGatewayHistory(messages: Array<{ role: string; content: string; status: string }>): GatewayMessage[] {
  return messages
    .filter((message) => message.status !== 'ERROR' && message.content.trim() !== '')
    .map((message) => ({ role: message.role.toLowerCase() as GatewayMessage['role'], content: message.content }));
}
