import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMAGES,
  VISION_MODELS,
  contentPart,
  defaultImages,
  effectiveImages,
  imageLimit,
  imageTokensFor,
  imagesAllowed,
  imagesInput,
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

test("new tenants may send images to local-mock only; limits are validated and merged", () => {
  assert.deepEqual(
    [...VISION_MODELS.keys()],
    ["local-mock", "google-gemini", "groq-vision", "openrouter-free"],
  );
  assert.deepEqual(defaultImages(), {
    enabled: true,
    models: ["local-mock"],
    maxImages: MAX_IMAGES,
  });
  assert.deepEqual(imagesInput(defaultImages()), defaultImages());
  assert.deepEqual(
    imagesInput({ models: ["google-gemini", "local-mock"], maxImages: "3" }),
    { enabled: true, models: ["local-mock", "google-gemini"], maxImages: 3 },
  );
  // Images off need no model.
  assert.deepEqual(imagesInput({ enabled: false, models: [] }), {
    enabled: false,
    models: [],
    maxImages: MAX_IMAGES,
  });
  for (const body of [
    { models: ["groq-llama"] },
    { models: ["local-mock", "local-mock"] },
    { models: [] },
    { maxImages: 0 },
    { maxImages: MAX_IMAGES + 1 },
    { maxImages: 2.5 },
    { enabled: "yes" },
    { perMessage: 2 },
    [],
    null,
  ])
    assert.throws(() => imagesInput(body), JSON.stringify(body));
});

test("a tenant sends images only to vision models of its limits that its plan includes", () => {
  const tenant = (
    images,
    models = ["local-mock", "google-gemini", "groq-llama"],
  ) => ({
    images,
    config: { models },
  });
  const both = {
    enabled: true,
    models: ["local-mock", "google-gemini"],
    maxImages: 2,
  };
  assert.deepEqual(effectiveImages(both, { models: ["local-mock"] }).models, [
    "local-mock",
  ]);
  assert.deepEqual(
    effectiveImages({ ...both, enabled: false }, { models: ["local-mock"] })
      .models,
    [],
  );
  // Tenants registered before image limits existed get the defaults.
  assert.deepEqual(
    effectiveImages(null, { models: ["local-mock"] }),
    defaultImages(),
  );
  assert.equal(imagesAllowed(tenant(both), "google-gemini", 2), true);
  assert.equal(imagesAllowed(tenant(both), "google-gemini", 3), false);
  assert.equal(
    imagesAllowed(tenant(both, ["local-mock"]), "google-gemini", 1),
    false,
  );
  assert.equal(
    imagesAllowed(tenant({ ...both, enabled: false }), "local-mock", 1),
    false,
  );
  assert.equal(imagesAllowed(tenant(null), "local-mock", MAX_IMAGES), true);
  assert.equal(imagesAllowed(tenant(null), "google-gemini", 1), false);
  for (const model of ["groq-llama", "openrouter-free", "mock-embedding"])
    assert.equal(imagesAllowed(tenant(both), model, 1), false);
});

test("a model takes no more images than its own, and reserves its own tokens per image", () => {
  for (const [model, { maxImages, imageTokens }] of VISION_MODELS) {
    assert.ok(maxImages >= 1 && maxImages <= MAX_IMAGES, model);
    assert.ok(imageTokens > 0, model);
  }
  const vision = [...VISION_MODELS.keys()];
  const all = { enabled: true, models: vision, maxImages: MAX_IMAGES };
  const limits = (images) =>
    Object.fromEntries(
      vision.map((model) => [model, imageLimit(images, model)]),
    );
  assert.deepEqual(limits(all), {
    "local-mock": 6,
    "google-gemini": 6,
    "groq-vision": 2,
    "openrouter-free": 4,
  });
  // A tenant's lower limit wins; a model without figures takes none.
  assert.deepEqual(limits({ ...all, maxImages: 3 }), {
    "local-mock": 3,
    "google-gemini": 3,
    "groq-vision": 2,
    "openrouter-free": 3,
  });
  assert.equal(imageLimit(all, "groq-llama"), 0);
  const tenant = { images: all, config: { models: vision } };
  assert.equal(imagesAllowed(tenant, "groq-vision", 2), true);
  assert.equal(imagesAllowed(tenant, "groq-vision", 3), false);
  assert.equal(imagesAllowed(tenant, "openrouter-free", 4), true);
  assert.equal(imagesAllowed(tenant, "openrouter-free", 5), false);
  assert.equal(imageTokensFor("google-gemini", 2), 2240);
  assert.equal(imageTokensFor("groq-vision", 2), 4096);
  assert.equal(imageTokensFor("openrouter-free", 0), 0);
  assert.equal(imageTokensFor("groq-llama", 3), 0);
});
