// Tenant-tunable retrieval settings. The vendor's limits (from vendor-control) frame them; the
// platform fixes the ranges no tenant may leave.
import { Fault } from "./errors.mjs";

export const EMBEDDING_DIMENSIONS = 768;
export const FILE_TYPES = ["csv", "txt", "md", "pdf"];
export const PLATFORM = {
  chunkSize: [400, 2000],
  minScore: [0, 0.9],
  overlapRatio: 0.4,
};

export function defaultSettings(limits) {
  return {
    embeddingModel: limits.embeddingModels.includes("mock-embedding")
      ? "mock-embedding"
      : (limits.embeddingModels[0] ?? "mock-embedding"),
    topK: Math.min(5, limits.maxTopK),
    minScore: 0,
    chunkSize: 1400,
    chunkOverlap: 300,
  };
}

const bad = (message) => new Fault(400, "invalid_settings", message);

/** Validated settings: the body's fields over the current ones, inside the tenant's limits. */
export function settingsInput(body, current, limits) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw bad("Settings must be an object");
  const unknown = Object.keys(body).filter((key) => !(key in current));
  if (unknown.length) throw bad(`Unknown setting: ${unknown.join(", ")}`);
  const next = { ...current, ...body };
  // A saved value above a limit the vendor lowered since is clamped, so other settings can change.
  if (body.topK === undefined) next.topK = Math.min(next.topK, limits.maxTopK);
  if (!limits.embeddingModels.includes(next.embeddingModel))
    throw bad(
      `Embedding model must be one of: ${limits.embeddingModels.join(", ") || "none (ask your vendor)"}`,
    );
  if (!Number.isInteger(next.topK) || next.topK < 1 || next.topK > limits.maxTopK)
    throw bad(`Top-K must be a whole number from 1 to ${limits.maxTopK}`);
  const [minScore, maxScore] = PLATFORM.minScore;
  if (typeof next.minScore !== "number" || !(next.minScore >= minScore && next.minScore <= maxScore))
    throw bad(`Minimum score must be from ${minScore} to ${maxScore}`);
  const [minSize, maxSize] = PLATFORM.chunkSize;
  if (!Number.isInteger(next.chunkSize) || next.chunkSize < minSize || next.chunkSize > maxSize)
    throw bad(`Chunk size must be a whole number from ${minSize} to ${maxSize} characters`);
  const maxOverlap = Math.floor(next.chunkSize * PLATFORM.overlapRatio);
  if (!Number.isInteger(next.chunkOverlap) || next.chunkOverlap < 0 || next.chunkOverlap > maxOverlap)
    throw bad(`Chunk overlap must be a whole number from 0 to ${maxOverlap} characters`);
  return {
    embeddingModel: next.embeddingModel,
    topK: next.topK,
    minScore: Math.round(next.minScore * 1000) / 1000,
    chunkSize: next.chunkSize,
    chunkOverlap: next.chunkOverlap,
  };
}

/** Changing any of these re-chunks and re-embeds every document as a new index version. */
export const reindexNeeded = (before, after) =>
  before.embeddingModel !== after.embeddingModel ||
  before.chunkSize !== after.chunkSize ||
  before.chunkOverlap !== after.chunkOverlap;

/** What applies right now: saved settings clamped to the current limits, and why search is off. */
export function effectiveSettings(settings, limits, active) {
  let problem = null;
  if (!limits.enabled) problem = "The knowledge base is turned off for your organization";
  else if (!limits.embeddingModels.includes(settings.embeddingModel))
    problem = `Embedding model ${settings.embeddingModel} is no longer in your plan; choose another one`;
  else if (active && !limits.embeddingModels.includes(active.model))
    problem = `The index was built with ${active.model}, which is no longer in your plan; choose another embedding model`;
  return {
    topK: Math.min(settings.topK, limits.maxTopK),
    minScore: settings.minScore,
    problem,
  };
}
