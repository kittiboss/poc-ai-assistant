import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CHAT_IMAGES } from "../attachments/attachments.service";
import { VISION_MODELS, imageTokensFor } from "./vision-models";

describe("vision model figures", () => {
  it("stay within the API's ceiling of images per chat", () => {
    for (const [id, { maxImages, imageTokens }] of VISION_MODELS) {
      expect(maxImages, id).toBeGreaterThan(0);
      expect(maxImages, id).toBeLessThanOrEqual(MAX_CHAT_IMAGES);
      expect(imageTokens, id).toBeGreaterThan(0);
    }
  });

  it("cover every model the seed gives vision, so none of them silently takes no images", () => {
    const seed = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");
    const seeded = [...seed.matchAll(/\{[^{}]*?\bid: "([^"]+)"[^{}]*?\}/g)]
      .filter(([block]) => block.includes('"vision"'))
      .map(([, id]) => id);
    expect(seeded.sort()).toEqual([...VISION_MODELS.keys()].sort());
  });

  it("count images by the model's own figure, and as nothing for a model without one", () => {
    expect(imageTokensFor("google-gemini", 2)).toBe(2_240);
    expect(imageTokensFor("groq-vision", 2)).toBe(4_096);
    expect(imageTokensFor("openrouter-free", 0)).toBe(0);
    expect(imageTokensFor("qwen-local", 3)).toBe(0);
  });
});
