// Chat images: which models may receive them and how they are checked and metered.
// See docs/CHAT_ATTACHMENTS.md (Vendor-managed deployments).

/**
 * The platform's vision models: the images a chat may hold, whatever the tenant's limit, and the
 * input tokens reserved per image, whatever the file size. They follow the providers'
 * documentation and match the customer API's table (apps/api/src/models/vision-models.ts), which a
 * test there checks. Settlement uses the provider's own count, so tokens per image only bound the
 * reservation.
 */
export const VISION_MODELS = new Map([
  // mock-provider reports 1,120 per image.
  ["local-mock", { maxImages: 6, imageTokens: 1120 }],
  // Gemini 3's default media resolution.
  ["google-gemini", { maxImages: 6, imageTokens: 1120 }],
  // Groq counts at most 2,048 per image and takes 3 a request; 2 leave room within 8,000 tokens a
  // minute, which every tenant shares.
  ["groq-vision", { maxImages: 2, imageTokens: 2048 }],
  // The free router picks a model per request, and each counts images its own way: an estimate.
  ["openrouter-free", { maxImages: 4, imageTokens: 2048 }],
]);
/** A request carries every image of its chat, and the customer API allows at most 6 a chat. */
export const MAX_IMAGES = 6;

/** The input tokens reserved for `images` images sent to `model`; 0 for a model that takes none. */
export const imageTokensFor = (model, images) =>
  images * (VISION_MODELS.get(model)?.imageTokens ?? 0);

const SIGNATURES = {
  "image/jpeg": (head) =>
    head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  "image/png": (head) =>
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (head) =>
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP",
};
const DATA_URL =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * One part of a message's content, rebuilt with only the fields that are forwarded. An image is
 * accepted only as inline data whose first bytes match its declared type, so a remote URL (which
 * the provider would fetch) or other media billed differently never leaves the platform.
 */
export function contentPart(part, role) {
  if (part?.type === "text" && typeof part.text === "string")
    return { type: "text", text: part.text };
  if (part?.type !== "image_url")
    throw new Error("Message parts must be text or image_url");
  if (role !== "user")
    throw new Error("Images are accepted in user messages only");
  const url = part.image_url?.url;
  const data = typeof url === "string" ? DATA_URL.exec(url) : null;
  if (!data)
    throw new Error(
      "An image must be a base64 data URL of a JPEG, PNG or WebP image",
    );
  if (!SIGNATURES[data[1]](Buffer.from(data[2].slice(0, 16), "base64")))
    throw new Error("An image's bytes do not match its declared type");
  return { type: "image_url", image_url: { url } };
}

// Image limits the vendor sets per tenant in the console (vendor.tenants.images). The customer API
// reads them from GET /v1/models; vendor-control enforces them on every request.

/** New tenants start mock-only, like their model plan. */
export const defaultImages = () => ({
  enabled: true,
  models: ["local-mock"],
  maxImages: MAX_IMAGES,
});

/** A complete, validated limits object; missing fields keep their current value. */
export function imagesInput(body, current = defaultImages()) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Image limits must be an object");
  const next = { ...current, ...body };
  const unknown = Object.keys(next).filter((key) => !(key in defaultImages()));
  if (unknown.length) throw new Error(`Unknown setting: ${unknown.join(", ")}`);
  if (typeof next.enabled !== "boolean")
    throw new Error("enabled must be true or false");
  const vision = [...VISION_MODELS.keys()];
  if (
    !Array.isArray(next.models) ||
    next.models.some((model) => !vision.includes(model)) ||
    new Set(next.models).size !== next.models.length
  )
    throw new Error(`models must be a list of: ${vision.join(", ")}`);
  const maxImages = Number(next.maxImages);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_IMAGES)
    throw new Error(`maxImages must be a whole number from 1 to ${MAX_IMAGES}`);
  if (next.enabled && !next.models.length)
    throw new Error("Choose at least one model");
  return {
    enabled: next.enabled,
    models: vision.filter((model) => next.models.includes(model)),
    maxImages,
  };
}

/** What the tenant may send: the vision models of its limits that its plan includes; none when off. */
export const effectiveImages = (images, config) => {
  const limits = images ?? defaultImages();
  return {
    ...limits,
    models: limits.enabled
      ? limits.models.filter((model) => config.models.includes(model))
      : [],
  };
};

/** The images a chat may hold for `model`: the lower of the tenant's limit and the model's own. */
export const imageLimit = (limits, model) =>
  Math.min(limits.maxImages, VISION_MODELS.get(model)?.maxImages ?? 0);

/** Whether `tenant` may send `images` images to `model` in one request. */
export const imagesAllowed = (tenant, model, images) => {
  const limits = effectiveImages(tenant.images, tenant.config);
  return limits.models.includes(model) && images <= imageLimit(limits, model);
};
