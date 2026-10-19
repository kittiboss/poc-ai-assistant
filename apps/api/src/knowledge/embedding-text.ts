import { createHash } from "node:crypto";

/** Every stored vector has this size; the column is vector(768). */
export const EMBEDDING_DIMENSIONS = 768;

/** Models flagged with this capability (Gemini Embedding 2) take the retrieval task as a text prefix instead of a task_type field. */
export const TASK_PREFIX_CAPABILITY = "task-prefix";

/** Models flagged with this capability accept a requested vector size (Gemini: outputDimensionality). Others must natively return EMBEDDING_DIMENSIONS. */
export const OUTPUT_DIMENSIONS_CAPABILITY = "output-dimensions";

export function documentInput(
  title: string,
  text: string,
  taskPrefix: boolean,
) {
  return taskPrefix ? `title: ${title} | text: ${text}` : `${title}\n${text}`;
}

export function queryInput(query: string, taskPrefix: boolean) {
  return taskPrefix ? `task: search result | query: ${query}` : query;
}

/** Identifies the exact text a vector was computed from, so unchanged items are never re-embedded. */
export function contentHash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

/** pgvector input literal for a parameterised `$1::vector` cast. */
export function vectorLiteral(vector: number[]) {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  )
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} finite values`);
  return `[${vector.join(",")}]`;
}
