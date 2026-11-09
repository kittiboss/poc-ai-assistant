/**
 * Models the platform runs itself (mock-provider); every other model calls an external provider
 * and counts toward the tenant's shared daily limit. Mirrors `localModels` in
 * apps/vendor-control/src/store.mjs.
 */
export const LOCAL_MODELS = new Set(['local-mock', 'mock-embedding']);
