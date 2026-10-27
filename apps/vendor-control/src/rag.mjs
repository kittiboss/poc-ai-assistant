// Knowledge (RAG) entitlements the vendor sets per tenant. The central RAG engine reads them
// through GET /customer/rag and enforces them; tenant admins tune their settings within them.
export const EMBEDDING_MODELS = ["mock-embedding", "gemini-embedding"];
export const FILE_TYPES = ["csv", "txt", "md", "pdf"];
const RANGES = {
  maxDocuments: [1, 200],
  maxFileMb: [1, 5], // The tenant API's document extractor stops at 5 MB.
  maxTextMb: [1, 50],
  maxChunksPerDocument: [1, 2000],
  maxTotalChunks: [1, 20000],
  maxTopK: [1, 10],
};

/** New tenants start mock-only, like their model plan. */
export const defaultRag = () => ({
  enabled: true,
  embeddingModels: ["mock-embedding"],
  allowedTypes: [...FILE_TYPES],
  maxDocuments: 20,
  maxFileMb: 5,
  maxTextMb: 10,
  maxChunksPerDocument: 500,
  maxTotalChunks: 3000,
  maxTopK: 8,
});

const subset = (value, allowed, name) => {
  if (
    !Array.isArray(value) ||
    value.some((item) => !allowed.includes(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name} must be a list of: ${allowed.join(", ")}`);
  return allowed.filter((item) => value.includes(item));
};

/** A complete, validated limits object; missing fields keep their current value. */
export function ragInput(body, current = defaultRag()) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Knowledge limits must be an object");
  const next = { ...current, ...body };
  const unknown = Object.keys(next).filter(
    (key) => !(key in defaultRag()),
  );
  if (unknown.length) throw new Error(`Unknown setting: ${unknown.join(", ")}`);
  if (typeof next.enabled !== "boolean")
    throw new Error("enabled must be true or false");
  const limits = {
    enabled: next.enabled,
    embeddingModels: subset(
      next.embeddingModels,
      EMBEDDING_MODELS,
      "embeddingModels",
    ),
    allowedTypes: subset(next.allowedTypes, FILE_TYPES, "allowedTypes"),
  };
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Number(next[key]);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} must be a whole number from ${min} to ${max}`);
    limits[key] = value;
  }
  if (limits.enabled && !limits.embeddingModels.length)
    throw new Error("Choose at least one embedding model");
  if (limits.enabled && !limits.allowedTypes.length)
    throw new Error("Choose at least one file type");
  if (limits.maxChunksPerDocument > limits.maxTotalChunks)
    throw new Error("maxChunksPerDocument cannot exceed maxTotalChunks");
  return limits;
}

/** What the engine enforces: the tenant's limits, with embedding models it is entitled to. */
export const effectiveRag = (rag, config) => {
  const limits = rag ?? defaultRag();
  return {
    ...limits,
    embeddingModels: limits.embeddingModels.filter((model) =>
      config.models.includes(model),
    ),
  };
};
