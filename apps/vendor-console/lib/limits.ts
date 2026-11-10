/**
 * What vendor-control accepts, so forms can say so before saving. Mirrors
 * apps/vendor-control/src/rag.mjs, images.mjs, money.mjs and the routes in server.mjs; vendor-control
 * still checks everything itself.
 */

/** A tenant ID: also its Keycloak realm and Docker project name. */
export const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;

/** The highest test credit one grant may add, in USD. */
export const MAX_GRANT_USD = 10_000;

/** A non-negative USD amount with at most 9 decimal places. */
export const USD_AMOUNT = /^\d{1,7}(\.\d{1,9})?$/;

export const EMBEDDING_MODELS = ['mock-embedding', 'gemini-embedding'];
export const FILE_TYPES = ['csv', 'txt', 'md', 'pdf'];

/** [min, max] of each knowledge limit. */
export const RAG_RANGES = {
  maxDocuments: [1, 200],
  maxFileMb: [1, 5],
  maxTextMb: [1, 50],
  maxChunksPerDocument: [1, 2000],
  maxTotalChunks: [1, 20000],
  maxTopK: [1, 10],
} as const;

/** Models that can receive chat images. */
export const VISION_MODELS = ['local-mock', 'google-gemini'];
export const MAX_IMAGES = 6;

/** Embedding models may have no output price; every other model needs both. */
export const isEmbeddingModel = (model: string) => EMBEDDING_MODELS.includes(model);
