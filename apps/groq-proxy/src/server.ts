import { createGroqProxy } from "./proxy";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error("GROQ_API_KEY is required");
const model = process.env.GROQ_MODEL;
if (!model) throw new Error("GROQ_MODEL is required");
// Optional: the model that may receive chat images. Without it, images are refused.
const visionModel = process.env.GROQ_VISION_MODEL || undefined;
const freeTierConfirmed = process.env.GROQ_FREE_TIER_CONFIRMED === "true";
const configuredMax = Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 1024);
const maxOutputTokens = Number.isFinite(configuredMax)
  ? Math.min(8192, Math.max(1, Math.trunc(configuredMax)))
  : 1024;

const port = Number(process.env.PORT || 4030);
createGroqProxy({
  apiKey,
  model,
  visionModel,
  maxOutputTokens,
  freeTierConfirmed,
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `Groq credential proxy listening on ${port} for ${model}${visionModel ? ` and ${visionModel} (images)` : ""} (max ${maxOutputTokens} output tokens; free tier ${freeTierConfirmed ? "confirmed" : "not confirmed"})\n`,
  );
});
