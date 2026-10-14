// Loaded before every API test file. The default suite must never reach a paid
// (or any non-local) AI provider, so any non-loopback fetch fails the test.
const realFetch = globalThis.fetch;
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
if (process.env.OLLAMA_TEST_URL) allowedHosts.add(new URL(process.env.OLLAMA_TEST_URL).hostname);

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!allowedHosts.has(url.hostname)) throw new Error(`Blocked non-local network call during tests: ${url.origin}`);
  return realFetch(input, init);
}) as typeof fetch;
