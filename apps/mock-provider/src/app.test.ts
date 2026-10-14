import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, MOCK_RESPONSE } from './app';

describe('OpenAI-compatible mock provider', () => {
  it('returns the required deterministic response', async () => {
    const response = await request(createApp()).post('/v1/chat/completions').send({
      model: 'mock-enterprise',
      messages: [{ role: 'user', content: 'Explain Docker Compose' }],
    });
    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toBe(MOCK_RESPONSE);
    expect(response.body.usage.total_tokens).toBeGreaterThan(0);
  });

  it('streams SSE and supports simulated errors', async () => {
    const stream = await request(createApp()).post('/v1/chat/completions').send({
      stream: true,
      messages: [{ role: 'user', content: 'Explain Docker Compose' }],
    });
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.text).toContain('[DONE]');
    const streamedText = stream.text.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '').join('');
    expect(streamedText).toBe(MOCK_RESPONSE);
    const failure = await request(createApp()).post('/v1/chat/completions').send({
      messages: [{ role: 'user', content: '[mock:error]' }],
    });
    expect(failure.status).toBe(503);
  });
});

