/**
 * What each vision model takes: how many images a chat may hold, and how many input tokens its
 * provider counts per image, whatever the file size. They follow the providers' documentation, not
 * an administrator's choice, and change only with the model, its route and its proxy. A model with
 * `vision` in the registry but no entry here receives no images. See docs/CHAT_ATTACHMENTS.md
 * (Vision models).
 */
export type VisionFigures = { maxImages: number; imageTokens: number };

export const VISION_MODELS: ReadonlyMap<string, VisionFigures> = new Map([
  // mock-provider reports 1,120 tokens per image.
  ["local-mock", { maxImages: 6, imageTokens: 1_120 }],
  // Gemini 3's default media resolution.
  ["google-gemini", { maxImages: 6, imageTokens: 1_120 }],
  // Groq's documentation counts 2,048 per image, an upper bound (a 900 x 1,200 receipt took 2,027 with
  // the whole prompt); it takes at most 3 in a request, and 2 leave room within 8,000 tokens a minute.
  ["groq-vision", { maxImages: 2, imageTokens: 2_048 }],
  // The router picks a different free model for each request, and each counts images its own way,
  // so this is an estimate; usage records what OpenRouter reports.
  ["openrouter-free", { maxImages: 4, imageTokens: 2_048 }],
]);

/** The input tokens counted for `images` images sent to this model; 0 when it takes none. */
export const imageTokensFor = (modelId: string, images: number) =>
  images * (VISION_MODELS.get(modelId)?.imageTokens ?? 0);
