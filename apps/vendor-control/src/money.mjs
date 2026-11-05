import { VISION_MODELS, contentPart } from "./images.mjs";

// All ledger arithmetic uses integer billionths of a simulated USD, never floating point.
export const SCALE = 1_000_000_000n;
export function money(value) {
  const text = String(value);
  if (!/^\d{1,7}(\.\d{1,9})?$/.test(text))
    throw new Error("Use a non-negative decimal with at most 9 decimal places");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, "0"));
}
export function usd(value) {
  const n = BigInt(value);
  return `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / SCALE}.${((n < 0n ? -n : n) % SCALE).toString().padStart(9, "0")}`;
}
export const charge = (input, output, price) =>
  (BigInt(input) * BigInt(price.input_rate) +
    BigInt(output) * BigInt(price.output_rate) +
    999_999n) /
  1_000_000n;

export function priceInput(body) {
  const inputCost = money(body.inputCost);
  const outputCost = money(body.outputCost);
  const strategy = body.strategy;
  if (!["PERCENTAGE_MARKUP", "FIXED_RATE"].includes(strategy))
    throw new Error("Invalid pricing strategy");
  const markup = Number(body.markupPercent ?? 0);
  if (!Number.isInteger(markup) || markup < 0 || markup > 10000)
    throw new Error("Markup must be an integer from 0 to 10000");
  const input =
    strategy === "FIXED_RATE"
      ? money(body.inputRate)
      : (inputCost * BigInt(100 + markup) + 99n) / 100n;
  const output =
    strategy === "FIXED_RATE"
      ? money(body.outputRate)
      : (outputCost * BigInt(100 + markup) + 99n) / 100n;
  if (
    input <= 0n ||
    (body.model !== "mock-embedding" &&
      body.model !== "gemini-embedding" &&
      output <= 0n)
  )
    throw new Error("Sale rates must be positive");
  return { input, output, inputCost, outputCost, strategy, markup };
}

/** Each message rebuilt with only its role and content; a list of parts keeps only text and images. */
function chatMessages(messages) {
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 256 ||
    messages.some((m) => !["system", "user", "assistant"].includes(m?.role))
  )
    throw new Error("Only streaming chat is supported");
  return messages.map(({ role, content }) => {
    if (typeof content === "string") return { role, content };
    if (!Array.isArray(content) || !content.length || content.length > 64)
      throw new Error("Message content must be text or a list of parts");
    return { role, content: content.map((part) => contentPart(part, role)) };
  });
}

// Text input is bounded by its UTF-8 bytes + framing, deliberately conservative compared to tokenizer
// counts; each image adds the fixed tokens of its model (images.mjs), never its base64 size.
export function validateRequest(body, embedding) {
  if (!body || typeof body.model !== "string")
    throw new Error("model is required");
  let text;
  let messages;
  let images = 0;
  if (embedding) {
    const inputs = typeof body.input === "string" ? [body.input] : body.input;
    if (
      !Array.isArray(inputs) ||
      !inputs.length ||
      inputs.length > 100 ||
      inputs.some((s) => typeof s !== "string")
    )
      throw new Error("Expected 1–100 text inputs");
    text = JSON.stringify(inputs);
  } else {
    if (body.stream !== true)
      throw new Error("Only streaming chat is supported");
    messages = chatMessages(body.messages);
    // The text as sent, with each image's data left out: images are counted below.
    text = JSON.stringify(
      messages.map(({ role, content }) => ({
        role,
        content:
          typeof content === "string"
            ? content
            : content.map((part) => {
                if (part.type === "text") return part;
                images++;
                return { type: "image_url" };
              }),
      })),
    );
  }
  const maxOutput = embedding ? 0 : Number(body.max_tokens ?? 1024);
  if (
    !Number.isSafeInteger(maxOutput) ||
    maxOutput < (embedding ? 0 : 1) ||
    maxOutput > 4096
  )
    throw new Error("max_tokens must be between 1 and 4096");
  const textInput = Buffer.byteLength(text, "utf8") + 512;
  if (textInput > 250000) throw new Error("Input too large");
  const input = textInput + images * (VISION_MODELS.get(body.model) ?? 0);
  // Do not forward user-controlled routing, metadata, credentials, tools or fallback parameters.
  const upstream = embedding
    ? {
        model: body.model,
        input: body.input,
        encoding_format: "float",
        ...(Number.isInteger(body.dimensions) &&
        body.dimensions > 0 &&
        body.dimensions <= 3072
          ? { dimensions: body.dimensions }
          : {}),
      }
    : {
        model: body.model,
        messages,
        max_tokens: maxOutput,
        stream: true,
        stream_options: { include_usage: true },
        ...(Number.isFinite(body.temperature) &&
        body.temperature >= 0 &&
        body.temperature <= 2
          ? { temperature: body.temperature }
          : {}),
      };
  return { input, output: maxOutput, upstream, images };
}
