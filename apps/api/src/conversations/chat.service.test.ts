import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin, localUser, usersWith } from '../testing/fixtures';
import { gateway, modelsService, prismaWith } from '../testing/model-fixtures';
import { gatewayError } from '../gateway/gateway.service';
import { ChatService, STALE_STREAM_MS } from './chat.service';
import { ConversationsService } from './conversations.service';

/** A chat without attachments. */
const noFiles = () => ({ forMessage: vi.fn().mockResolvedValue({ files: [], added: [] }), markSent: vi.fn() });

describe('chat streaming lifecycle', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses an external request over the daily limit before opening a stream or persisting messages', async () => {
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    vi.stubEnv('EXTERNAL_DAILY_TOKEN_LIMIT', '1000');
    const prisma = { ...prismaWith({ requests: 1, tokens: 1000 }), message: { create: vi.fn() },
      conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conversation-1', userId: localUser.id, title: 'x' }) } };
    const response = { status: vi.fn(), write: vi.fn() };
    const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const error = await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'google-gemini' }, response as never).catch((cause) => cause);
    expect(error.getStatus()).toBe(429);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  describe('prepaid credit on the platform gateway', () => {
    const localMock = { id: 'local-mock', provider: 'MOCK', enabled: true, local: true, allowedRoles: ['USER', 'ADMIN'], capabilities: ['chat'], contextWindow: 8192, permissions: [] };
    const conversation = { id: 'conversation-1', userId: localUser.id, title: 'x', projectId: null };

    it('refuses a message once the credit is used up, before persisting anything or opening a stream', async () => {
      gateway.credit.mockResolvedValueOnce({ currency: 'USD', limit: 1, spent: 1, remaining: 0, exhausted: true });
      const prisma = { ...prismaWith({ requests: 0, tokens: 0 }), message: { create: vi.fn() },
        aIModel: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(localMock) },
        conversation: { findFirst: vi.fn().mockResolvedValue(conversation) } };
      const response = { status: vi.fn(), write: vi.fn() };
      const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      const error = await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'local-mock' }, response as never).catch((cause) => cause);
      expect(error.getStatus()).toBe(402);
      expect(error.getResponse()).toMatchObject({ code: 'CREDIT_EXHAUSTED' });
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });

    it('tells the web why the gateway refused a started stream, and records no tokens for it', async () => {
      const prisma = { ...prismaWith({ requests: 0, tokens: 0 }),
        message: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
        usageRecord: { findUnique: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { totalTokens: 0 } }) },
        aIModel: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(localMock) },
        conversation: { findFirst: vi.fn().mockResolvedValue(conversation), update: vi.fn() },
        $transaction: vi.fn().mockResolvedValue([{ id: 'user-message' }, { id: 'assistant-message' }, {}]) };
      const usage = { record: vi.fn().mockResolvedValue({}) };
      const workspace = { context: vi.fn().mockResolvedValue({ instructions: 'system', citations: [], maxOutputTokens: 64 }) };
      const governance = { reserve: vi.fn(), release: vi.fn(), checkSensitive: vi.fn(), settings: vi.fn() };
      const refusing = { ...gateway, maxOutputTokens: () => 64, stream: vi.fn().mockRejectedValue(gatewayError(400, 'budget_exceeded')) };
      const response = { status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), on: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false };
      const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), refusing as never, usage as never, workspace as never, governance as never, {} as never, noFiles() as never);
      await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'local-mock' }, response as never);
      const errorEvent = response.write.mock.calls.map(([chunk]) => String(chunk)).find((chunk) => chunk.startsWith('event: error'));
      expect(JSON.parse(errorEvent!.split('data: ')[1])).toMatchObject({ code: 'CREDIT_EXHAUSTED' });
      expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR', usage: { prompt_tokens: 0, completion_tokens: 0 } }));
      expect(governance.release).toHaveBeenCalled();
    });
  });

  it('marks streams abandoned by an API restart as INTERRUPTED', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = Date.parse('2026-10-14T12:00:00Z');
    const chat = new ChatService({ message: { updateMany } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await chat.interruptStaleStreams(now)).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['PENDING', 'STREAMING'] }, updatedAt: { lt: new Date(now - STALE_STREAM_MS) } },
      data: { status: 'INTERRUPTED' },
    });
  });

  describe('attachments', () => {
    const localMock = { id: 'local-mock', provider: 'MOCK', enabled: true, local: true, allowedRoles: ['USER', 'ADMIN'], capabilities: ['chat'], contextWindow: 8192, permissions: [] };
    const report = { id: 'a-report', filename: 'report.pdf', byteSize: 2048, pageCount: 2, charCount: 26 };
    const notes = { id: 'a-notes', filename: 'notes.md', byteSize: 30, pageCount: null, charCount: 14 };
    const withText = <T extends { charCount: number }>(file: T, content: string) => ({ ...file, content, charCount: content.length });
    const setup = (forMessage: { files: object[]; added: object[] }) => {
      const prisma = { ...prismaWith({ requests: 0, tokens: 0 }),
        message: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
        usageRecord: { findUnique: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { totalTokens: 0 } }) },
        aIModel: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(localMock) },
        conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conversation-1', userId: localUser.id, title: 'New conversation', projectId: null }), update: vi.fn() },
        $transaction: vi.fn().mockResolvedValue([{ id: 'user-message' }, { id: 'assistant-message' }, {}, {}]) };
      const stream = vi.fn(async (_model: string, _history: unknown, _signal: unknown, onToken: (text: string) => void) => {
        onToken('ok');
        return { prompt_tokens: 1, completion_tokens: 1 };
      });
      const knowledge = { retrieve: vi.fn().mockResolvedValue([]) };
      const attachments = { forMessage: vi.fn().mockResolvedValue(forMessage), markSent: vi.fn() };
      const governance = { reserve: vi.fn(), release: vi.fn(), checkSensitive: vi.fn(), settings: vi.fn() };
      const response = { status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), on: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false };
      const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma),
        { ...gateway, maxOutputTokens: () => 1024, stream } as never, { record: vi.fn().mockResolvedValue({}) } as never,
        { context: vi.fn().mockResolvedValue({ instructions: 'system', citations: [] }) } as never, governance as never, knowledge as never, attachments as never);
      const sent = () => {
        const [, history, , , options] = stream.mock.calls[0] as unknown as [string, { role: string; content: string }[], unknown, unknown, { maxOutputTokens: number }];
        return { system: history[0].content, user: history.at(-1)!.content, maxOutputTokens: options.maxOutputTokens };
      };
      return { prisma, chat, attachments, knowledge, response, sent };
    };

    it('sends files without text as a request for a short overview, and keeps the stored message empty', async () => {
      const file = withText(report, '[Page 1]\nLeave policy\n\n[Page 2]\nApprovals');
      const { prisma, chat, attachments, knowledge, response, sent } = setup({ files: [file], added: [report] });
      await chat.stream(admin, 'conversation-1', { content: '', modelId: 'local-mock', attachmentIds: ['a-report'], locale: 'th', useKnowledge: true }, response as never);
      expect(attachments.forMessage).toHaveBeenCalledWith(localUser.id, 'conversation-1', ['a-report']);
      expect(knowledge.retrieve).not.toHaveBeenCalled();
      const { system, user, maxOutputTokens } = sent();
      expect(user).toBe('[Attached without a message: report.pdf]');
      expect(system).toContain('Reply in Thai.');
      expect(system).toContain(JSON.stringify([{ filename: 'report.pdf', pages: 2, content: file.content }]));
      expect(maxOutputTokens).toBe(400);
      expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ role: 'USER', content: '', metadata: { attachments: [report] } });
      expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'report.pdf' }) }));
      expect(attachments.markSent).toHaveBeenCalledWith(['a-report']);
    });

    it("keeps every file of the chat in the context of a message with text", async () => {
      const files = [withText(report, 'Leave policy'), withText(notes, 'Meeting notes')];
      const { prisma, chat, attachments, response, sent } = setup({ files, added: [notes] });
      await chat.stream(admin, 'conversation-1', { content: 'Compare them', modelId: 'local-mock', attachmentIds: ['a-notes'] }, response as never);
      const { system, user, maxOutputTokens } = sent();
      expect(user).toBe('Compare them');
      expect(system).toContain('"filename":"report.pdf"');
      expect(system).toContain('"filename":"notes.md"');
      expect(system).not.toContain('only attaches files');
      expect(maxOutputTokens).toBe(1024);
      expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ content: 'Compare them', metadata: { attachments: [notes] } });
      expect(attachments.markSent).toHaveBeenCalledWith(['a-notes']);
    });

    it('stores no attachment metadata on a message without files', async () => {
      const { prisma, chat, response } = setup({ files: [], added: [] });
      await chat.stream(admin, 'conversation-1', { content: 'hi', modelId: 'local-mock' }, response as never);
      expect(prisma.message.create.mock.calls[0][0].data).not.toHaveProperty('metadata');
    });

    it('refuses a message with neither text nor files before loading anything', async () => {
      const { chat, attachments } = setup({ files: [], added: [] });
      await expect(chat.stream(admin, 'conversation-1', { content: '  ', modelId: 'local-mock' }, {} as never)).rejects.toMatchObject({ status: 400 });
      expect(attachments.forMessage).not.toHaveBeenCalled();
    });

    it('names the context limit with a code, before persisting anything', async () => {
      const file = withText(report, 'ก'.repeat(3000));
      const { prisma, chat, response } = setup({ files: [file], added: [report] });
      const error = await chat.stream(admin, 'conversation-1', { content: 'Summarize', modelId: 'local-mock', attachmentIds: ['a-report'] }, response as never).catch((cause) => cause);
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({ code: 'CONTEXT_TOO_LONG' });
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
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
      const chat = new ChatService(prisma as never, usersWith(prisma), new ConversationsService(prisma as never, usersWith(prisma)), modelsService(prisma), gateway as never, {} as never, workspace as never, {} as never, knowledge as never, noFiles() as never);
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

    it('searches the knowledge base when the message asks for it (vendor-managed clients)', async () => {
      const passage = { id: 'chunk-9', sourceId: 'document:d1', filename: 'policy.pdf', page: 3, content: 'Refunds within 45 days', kind: 'document', score: 0.9 };
      const knowledge = { retrieve: vi.fn().mockResolvedValue([passage]) };
      const { workspace, chat } = setup(knowledge);
      await chat.stream(admin, 'conversation-1', { content: 'refund window?', modelId: 'local-mock', useKnowledge: true, requestId: 'r-2' }, {} as never).catch(() => undefined);
      expect(knowledge.retrieve).toHaveBeenCalledWith(expect.objectContaining({ query: 'refund window?', requestId: 'r-2' }));
      expect(workspace.context.mock.calls[0][6]).toEqual([passage]);
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
