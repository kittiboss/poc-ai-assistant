import { createGeminiProxy } from './proxy';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is required');

const port = Number(process.env.PORT || 4020);
createGeminiProxy(apiKey).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Gemini credential proxy listening on ${port}\n`);
});
