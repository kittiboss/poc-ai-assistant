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
    const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, {} as never, {} as never, {} as never);
    const error = await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'google-gemini' }, response as never).catch((cause) => cause);
    expect(error.getStatus()).toBe(429);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('marks streams abandoned by an API restart as INTERRUPTED', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = Date.parse('2026-10-14T12:00:00Z');
    const chat = new ChatService({ message: { updateMany } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await chat.interruptStaleStreams(now)).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['PENDING', 'STREAMING'] }, updatedAt: { lt: new Date(now - STALE_STREAM_MS) } },
      data: { status: 'INTERRUPTED' },
    });
  });

  describe('product catalog retrieval', () => {
    const setup = (knowledge: { retrieve: ReturnType<typeof vi.fn> }) => {
      const prisma = { ...prismaWith({ requests: 0, tokens: 0 }), message: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
        usageRecord: { findUnique: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { totalTokens: 0 } }) },
        aIModel: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'local-mock', provider: 'MOCK', enabled: true, local: true, allowedRoles: ['USER'], capabilities: ['chat'], contextWindow: 8192, permissions: [] }) },
        conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conversation-1', userId: localUser.id, title: 'x', projectId: null }) } };
      // Stop right after context assembly; these tests only cover what happens before it.
      const workspace = { context: vi.fn().mockRejectedValue(new Error('stop after context')) };
      const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, workspace as never, {} as never, knowledge as never);
      return { prisma, workspace, chat };
    };

    it('does not search the catalog unless the message asks for it', async () => {
      const knowledge = { retrieve: vi.fn() };
      const { workspace, chat } = setup(knowledge);
      await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'local-mock' }, {} as never).catch(() => undefined);
      expect(knowledge.retrieve).not.toHaveBeenCalled();
      expect(workspace.context.mock.calls[0][6]).toEqual([]);
    });

    it('passes retrieved products into the model context', async () => {
      const product = { id: 'chunk-1', sourceId: 'product:2', filename: 'Auralis Nova Wireless Earbuds (ELC-0002)', page: null, content: 'Product: Auralis Nova', kind: 'product', score: 0.8 };
      const knowledge = { retrieve: vi.fn().mockResolvedValue([product]) };
      const { workspace, chat } = setup(knowledge);
      await chat.stream(admin, 'conversation-1', { content: 'water resistant earbuds?', modelId: 'local-mock', useProductCatalog: true, requestId: 'r-1' }, {} as never).catch(() => undefined);
      expect(knowledge.retrieve).toHaveBeenCalledWith(expect.objectContaining({ query: 'water resistant earbuds?', conversationId: 'conversation-1', requestId: 'r-1' }));
      expect(workspace.context.mock.calls[0][6]).toEqual([product]);
    });

    it('fails before persisting anything when the catalog search fails', async () => {
      const knowledge = { retrieve: vi.fn().mockRejectedValue(new Error('The product catalog has not been indexed yet')) };
      const { prisma, workspace, chat } = setup(knowledge);
      const response = { status: vi.fn() };
      await expect(chat.stream(admin, 'conversation-1', { content: 'earbuds?', modelId: 'local-mock', useProductCatalog: true }, response as never)).rejects.toThrow(/not been indexed/);
      expect(workspace.context).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });
  });
});
