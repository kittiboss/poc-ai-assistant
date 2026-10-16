import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin, localUser, usersWith } from '../testing/fixtures';
import { gateway, modelsService, prismaWith } from '../testing/model-fixtures';
import { ChatService, STALE_STREAM_MS } from './chat.service';
import { ConversationsService } from './conversations.service';

describe('chat streaming lifecycle', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses an external request over the daily limit before opening a stream or persisting messages', async () => {
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    vi.stubEnv('EXTERNAL_DAILY_TOKEN_LIMIT', '1000');
    const prisma = { ...prismaWith({ requests: 1, tokens: 1000 }), message: { create: vi.fn() },
      conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conversation-1', userId: localUser.id, title: 'x' }) } };
    const response = { status: vi.fn(), write: vi.fn() };
    const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, {} as never, {} as never);
    const error = await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'google-gemini' }, response as never).catch((cause) => cause);
    expect(error.getStatus()).toBe(429);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('marks streams abandoned by an API restart as INTERRUPTED', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = Date.parse('2026-10-14T12:00:00Z');
    const chat = new ChatService({ message: { updateMany } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await chat.interruptStaleStreams(now)).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['PENDING', 'STREAMING'] }, updatedAt: { lt: new Date(now - STALE_STREAM_MS) } },
      data: { status: 'INTERRUPTED' },
    });
  });
});
