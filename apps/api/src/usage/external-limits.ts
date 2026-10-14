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
