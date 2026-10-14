import express from 'express';
import { randomUUID } from 'node:crypto';

export const MOCK_RESPONSE = 'This is a mock AI response for local POC testing.';

type ChatMessage = { role: string; content: string };

function tokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function responseFor(messages: ChatMessage[]) {
  const prompt = messages.at(-1)?.content || '';
  if (/explain docker compose/i.test(prompt)) return MOCK_RESPONSE;
  return `${MOCK_RESPONSE}\n\nReceived: ${prompt.slice(0, 160)}`;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', provider: 'mock' }));
  app.get('/v1/models', (_req, res) =>
    res.json({ object: 'list', data: [{ id: 'mock-enterprise', object: 'model', owned_by: 'internal' }] }),
  );
  app.post('/v1/chat/completions', async (req, res) => {
    const messages = Array.isArray(req.body.messages) ? (req.body.messages as ChatMessage[]) : [];
    const prompt = messages.at(-1)?.content || '';
    if (prompt.includes('[mock:error]')) return res.status(503).json({ error: { message: 'Simulated provider error' } });
    if (prompt.includes('[mock:timeout]')) await new Promise((resolve) => setTimeout(resolve, 5000));

    const id = `chatcmpl-${randomUUID()}`;
    const content = responseFor(messages);
    const usage = {
      prompt_tokens: tokenCount(messages.map((m) => m.content).join(' ')),
      completion_tokens: tokenCount(content),
    };
    const created = Math.floor(Date.now() / 1000);

    if (!req.body.stream) {
      return res.json({
        id,
        object: 'chat.completion',
        created,
        model: 'mock-enterprise',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
      });
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    // Word-sized chunks that together reproduce the content exactly, including newlines and long tokens.
    const chunks = content.match(/\S+\s*|\s+/g) || [content];
    for (const chunk of chunks) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'mock-enterprise', choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'mock-enterprise', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return app;
}

