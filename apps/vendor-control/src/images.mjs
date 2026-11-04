// Chat images: which models may receive them and how they are checked and metered.
// See docs/CHAT_ATTACHMENTS.md (Vendor-managed deployments).

/**
 * The platform's vision models and the input tokens reserved per image: Gemini 3's default media
 * resolution, whatever the file size. mock-provider reports the same. Settlement uses the
 * provider's own count, so this only bounds the reservation.
 */
export const VISION_MODELS = new Map([
  ["local-mock", 1120],
  ["google-gemini", 1120],
]);
/** A request carries every image of its chat, and the customer API allows at most 6 a chat. */
export const MAX_IMAGES = 6;

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

/** Whether the platform lets `model` receive `images` images in one request. */
export const imagesAllowed = (model, images) =>
  VISION_MODELS.has(model) && images <= MAX_IMAGES;
