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

// Text-only requests. UTF-8 bytes + framing is deliberately conservative compared to tokenizer counts.
export function validateRequest(body, embedding) {
  if (!body || typeof body.model !== "string")
    throw new Error("model is required");
  let text;
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
    if (
      body.stream !== true ||
      !Array.isArray(body.messages) ||
      !body.messages.length ||
      body.messages.length > 256 ||
      body.messages.some(
        (m) =>
          !["system", "user", "assistant"].includes(m.role) ||
          typeof m.content !== "string",
      )
    )
      throw new Error("Only streaming text chat is supported");
    text = JSON.stringify(body.messages);
  }
  const maxOutput = embedding ? 0 : Number(body.max_tokens ?? 1024);
  if (
    !Number.isSafeInteger(maxOutput) ||
    maxOutput < (embedding ? 0 : 1) ||
    maxOutput > 4096
  )
    throw new Error("max_tokens must be between 1 and 4096");
  const input = Buffer.byteLength(text, "utf8") + 512;
  if (input > 250000) throw new Error("Input too large");
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
        messages: body.messages,
        max_tokens: maxOutput,
        stream: true,
        stream_options: { include_usage: true },
        ...(Number.isFinite(body.temperature) &&
        body.temperature >= 0 &&
        body.temperature <= 2
          ? { temperature: body.temperature }
          : {}),
      };
  return { input, output: maxOutput, upstream };
}
