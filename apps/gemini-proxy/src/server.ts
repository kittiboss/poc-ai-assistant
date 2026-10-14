import { createGeminiProxy } from './proxy';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is required');
const model = process.env.GEMINI_MODEL;
if (!model) throw new Error('GEMINI_MODEL is required');
const configuredMax = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1024);
const maxOutputTokens = Number.isFinite(configuredMax) ? Math.min(4096, Math.max(1, Math.trunc(configuredMax))) : 1024;

const port = Number(process.env.PORT || 4020);
createGeminiProxy({ apiKey, model, maxOutputTokens }).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Gemini credential proxy listening on ${port} for ${model} (max ${maxOutputTokens} output tokens)\n`);
});
