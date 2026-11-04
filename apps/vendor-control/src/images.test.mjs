import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMAGES,
  VISION_MODELS,
  contentPart,
  imagesAllowed,
} from "./images.mjs";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1,
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([36, 0, 0, 0]),
  Buffer.from("WEBPVP8X"),
]);
const dataUrl = (type, bytes) =>
  `data:${type};base64,${bytes.toString("base64")}`;
const image = (url, extra = {}) => ({
  type: "image_url",
  image_url: { url, ...extra },
  ...extra,
});

test("images are accepted only as inline JPEG, PNG or WebP data that matches its type", () => {
  for (const [type, bytes] of [
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/webp", WEBP],
  ])
    assert.deepEqual(contentPart(image(dataUrl(type, bytes)), "user"), {
      type: "image_url",
      image_url: { url: dataUrl(type, bytes) },
    });
  for (const url of [
    "https://example.invalid/cat.png",
    dataUrl("image/gif", Buffer.from("GIF89a")),
    dataUrl("application/pdf", Buffer.from("%PDF-1.7")),
    dataUrl("image/jpeg", PNG),
    dataUrl("image/png", Buffer.from("not an image")),
    "data:image/png;base64,***",
    `data:image/png,${PNG.toString("latin1")}`,
  ])
    assert.throws(() => contentPart(image(url), "user"), url);
  assert.throws(() => contentPart({ type: "image_url" }, "user"));
});

test("parts keep only the fields that are forwarded; images only in user messages", () => {
  assert.deepEqual(
    contentPart(
      image(dataUrl("image/png", PNG), { detail: "high", name: "x" }),
      "user",
    ),
    { type: "image_url", image_url: { url: dataUrl("image/png", PNG) } },
  );
  assert.deepEqual(
    contentPart({ type: "text", text: "hi", cache_control: {} }, "system"),
    {
      type: "text",
      text: "hi",
    },
  );
  for (const role of ["system", "assistant"])
    assert.throws(() => contentPart(image(dataUrl("image/png", PNG)), role));
  for (const part of [
    { type: "input_audio", input_audio: { data: "", format: "wav" } },
    { type: "file", file: { file_data: "" } },
    { type: "text", text: 1 },
    null,
  ])
    assert.throws(() => contentPart(part, "user"));
});

test("only the platform's vision models take images, at most a chat's worth a request", () => {
  assert.deepEqual([...VISION_MODELS.keys()], ["local-mock", "google-gemini"]);
  assert.equal(imagesAllowed("local-mock", MAX_IMAGES), true);
  assert.equal(imagesAllowed("google-gemini", 1), true);
  assert.equal(imagesAllowed("local-mock", MAX_IMAGES + 1), false);
  for (const model of ["groq-llama", "openrouter-free", "mock-embedding"])
    assert.equal(imagesAllowed(model, 1), false);
});
