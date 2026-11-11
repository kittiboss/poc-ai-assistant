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

/**
 * Models that can receive chat images: the images a chat may hold whatever the tenant's limit, and the
 * input tokens reserved per image. Mirrors VISION_MODELS in images.mjs; a test in apps/api checks.
 */
export const VISION_MODELS: ReadonlyMap<string, { maxImages: number; imageTokens: number }> = new Map([
  ['local-mock', { maxImages: 6, imageTokens: 1120 }],
  ['google-gemini', { maxImages: 6, imageTokens: 1120 }],
  ['groq-vision', { maxImages: 2, imageTokens: 2048 }],
  ['openrouter-free', { maxImages: 4, imageTokens: 2048 }],
]);
/** The most images a tenant's limit may allow a chat. */
export const MAX_IMAGES = 6;

/** The vision models that take fewer images than `max` a chat, with what each takes. */
export const imageCaps = (models: Iterable<string>, max: number) =>
  [...models].flatMap((model) => {
    const own = VISION_MODELS.get(model)?.maxImages;
    return own !== undefined && own < max ? [{ model, maxImages: own }] : [];
  });

/** Embedding models may have no output price; every other model needs both. */
export const isEmbeddingModel = (model: string) => EMBEDDING_MODELS.includes(model);
