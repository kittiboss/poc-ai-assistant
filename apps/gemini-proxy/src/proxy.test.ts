import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl } from './proxy';

describe('Gemini credential proxy', () => {
  it('removes LiteLLM query credentials before forwarding upstream', () => {
    const url = buildUpstreamUrl('/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?key=local-dummy&alt=sse');
    expect(url.origin).toBe('https://generativelanguage.googleapis.com');
    expect(url.pathname).toBe('/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent');
    expect(url.searchParams.has('key')).toBe(false);
    expect(url.searchParams.get('alt')).toBe('sse');
  });

  it('normalizes the model path emitted for a custom Gemini API base', () => {
    const url = buildUpstreamUrl('/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
    expect(url.pathname).toBe('/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent');
  });
});
