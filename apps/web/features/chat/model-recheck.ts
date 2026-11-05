import type { Model } from '@/lib/api/types';

/**
 * Waits before checking the model list again while no model can be used. A gateway that was slow for a
 * moment is back at the first check; one that is down for long is asked at most once a minute.
 */
export const MODEL_RECHECK_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

/**
 * Whether checking again can help: no model can be used and at least one is only unreachable for now.
 * Credit, limits, permissions and disabled models do not change by waiting.
 */
export const recheckHelps = (models: Pick<Model, 'available' | 'status'>[]) =>
  !models.some((model) => model.available) && models.some((model) => model.status === 'Unavailable');

/** The wait after `misses` checks in a row (at least 1) that found no model to use. */
export const recheckAfter = (misses: number) =>
  MODEL_RECHECK_MS[Math.min(Math.max(misses, 1), MODEL_RECHECK_MS.length) - 1];
