import { describe, expect, it } from "vitest";
import {
  bytes,
  extendedWebp,
  jpeg,
  losslessWebp,
  png,
  riff,
  webp,
} from "../testing/image-fixtures";
import { imageSize, imageType } from "./images";

describe("image headers", () => {
  it.each([
    ["PNG", png(1600, 900), "image/png", [1600, 900]],
    ["baseline JPEG", jpeg(1200, 1600), "image/jpeg", [1200, 1600]],
    ["progressive JPEG", jpeg(640, 480, 0xc2), "image/jpeg", [640, 480]],
    ["lossy WebP", webp(1600, 1066), "image/webp", [1600, 1066]],
    ["lossless WebP", losslessWebp(800, 600), "image/webp", [800, 600]],
    ["extended WebP", extendedWebp(2000, 1), "image/webp", [2000, 1]],
  ] as const)(
    "reads the type and size of a %s",
    (_name, file, type, [width, height]) => {
      expect(imageType(file)).toBe(type);
      expect(imageSize(file, type)).toEqual({ width, height });
    },
  );

  it("goes by the bytes, never the name, and leaves other files and animated WebP to the document checks", () => {
    expect(imageType(Buffer.from("GIF89a"))).toBeNull();
    expect(imageType(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
    expect(imageType(extendedWebp(100, 100, 0x02))).toBeNull();
  });

  it("cannot read the size of a damaged or truncated file", () => {
    expect(imageSize(png(1600, 900).subarray(0, 20), "image/png")).toBeNull();
    expect(imageSize(png(0, 900), "image/png")).toBeNull();
    expect(imageSize(jpeg(640, 480).subarray(0, 28), "image/jpeg")).toBeNull();
    // Image data before any frame header, and a segment shorter than its own length field.
    expect(
      imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]), "image/jpeg"),
    ).toBeNull();
    expect(
      imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0]), "image/jpeg"),
    ).toBeNull();
    const noKeyFrame = webp(100, 100);
    noKeyFrame[23] = 0;
    expect(imageSize(noKeyFrame, "image/webp")).toBeNull();
    expect(imageSize(riff("ALPH", Buffer.alloc(20)), "image/webp")).toBeNull();
  });
});
