import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, MOCK_RESPONSE, mockEmbedding } from './app';

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

  it('streams exactly the same text as the non-streamed response, including code and blank lines', async () => {
    const messages = [{ role: 'user', content: 'Show code\n\n```js\nconst total = items.reduce((sum, x) => sum + x, 0);\n```' }];
    const whole = await request(createApp()).post('/v1/chat/completions').send({ messages });
    const stream = await request(createApp()).post('/v1/chat/completions').send({ stream: true, messages });
    const streamedText = stream.text.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '').join('');
    expect(streamedText).toBe(whole.body.choices[0].message.content);
    expect(streamedText).toContain('items.reduce');
  });

  it('embeds deterministically, normalised, and closer for texts that share words', async () => {
    const response = await request(createApp()).post('/v1/embeddings').send({
      input: ['wireless earbuds with IPX5 water resistance', 'earbuds IPX5 water resistant', 'enameled cast iron dutch oven'],
      dimensions: 768,
    });
    expect(response.status).toBe(200);
    const [a, b, c] = response.body.data.map((item: { embedding: number[] }) => item.embedding);
    const dot = (x: number[], y: number[]) => x.reduce((sum, value, i) => sum + value * y[i], 0);
    expect(a).toHaveLength(768);
    expect(dot(a, a)).toBeCloseTo(1, 6);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
    expect(mockEmbedding('wireless earbuds with IPX5 water resistance')).toEqual(a);
    expect(response.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(mockEmbedding('')[0]).toBe(1);
  });
});
