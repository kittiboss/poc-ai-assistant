import { createOpenRouterProxy } from "./proxy";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
const model = process.env.OPENROUTER_MODEL || "openrouter/free";
if (model !== "openrouter/free") {
  throw new Error(
    "OPENROUTER_MODEL must remain openrouter/free in free-only mode",
  );
}
const configuredMax = Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || 1024);
const maxOutputTokens = Number.isFinite(configuredMax)
  ? Math.min(8192, Math.max(1, Math.trunc(configuredMax)))
  : 1024;

const port = Number(process.env.PORT || 4040);
createOpenRouterProxy({ apiKey, model, maxOutputTokens }).listen(
  port,
  "0.0.0.0",
  () => {
    process.stdout.write(
      `OpenRouter credential proxy listening on ${port} for ${model} (free-only; max ${maxOutputTokens} output tokens)\n`,
    );
  },
);
