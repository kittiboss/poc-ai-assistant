import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_CHAT_IMAGES } from "../attachments/attachments.service";
import { VISION_MODELS, type VisionFigures } from "./vision-models";

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

  it("match vendor-control's, which limits and meters the same models for vendor-managed customers", async () => {
    const vendor = pathToFileURL(
      resolve(process.cwd(), "../vendor-control/src/images.mjs"),
    ).href;
    const { VISION_MODELS: platform } = (await import(vendor)) as {
      VISION_MODELS: ReadonlyMap<string, VisionFigures>;
    };
    expect(Object.fromEntries(platform)).toEqual(
      Object.fromEntries(VISION_MODELS),
    );
  });
});
