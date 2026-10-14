import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MessageRole, MessageStatus, RequestStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { ModelsService } from '../models/models.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import { toGatewayHistory } from './chat-history';
import type { SendMessageDto } from './conversations.dto';
import { ConversationsService } from './conversations.service';

/** Longer than any gateway timeout; a stream this old cannot still be attached to a client. */
export const STALE_STREAM_MS = 10 * 60_000;

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly models: ModelsService,
    private readonly gateway: GatewayService,
    private readonly usage: UsageService,
  ) {}

  onModuleInit() {
    void this.interruptStaleStreams();
    this.sweepTimer = setInterval(() => void this.interruptStaleStreams(), 60_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy() { clearInterval(this.sweepTimer); }

  /** SSE streams do not survive an API restart; mark abandoned assistant messages instead of leaving them STREAMING forever. */
  async interruptStaleStreams(now = Date.now()) {
    try {
      const { count } = await this.prisma.message.updateMany({
        where: { status: { in: [MessageStatus.PENDING, MessageStatus.STREAMING] }, updatedAt: { lt: new Date(now - STALE_STREAM_MS) } },
        data: { status: MessageStatus.INTERRUPTED },
      });
      if (count) this.logger.warn(`Marked ${count} abandoned streaming message(s) as INTERRUPTED`);
      return count;
    } catch (error) {
      this.logger.error(`Stale stream sweep failed: ${(error as Error).message}`);
      return 0;
    }
  }

  async stream(auth: AuthUser, conversationId: string, dto: SendMessageDto, response: Response) {
    const user = await this.users.syncUser(auth);
    const conversation = await this.conversations.owned(user.id, conversationId);
    const model = await this.models.resolveForChat(user.id, auth.roles, dto.modelId);
    const requestId = dto.requestId || randomUUID();
    const [duplicateUsage, duplicateMessage] = await Promise.all([
      this.prisma.usageRecord.findUnique({ where: { requestId } }),
      this.prisma.message.findUnique({ where: { requestId } }),
    ]);
    if (duplicateUsage || duplicateMessage) throw new BadRequestException('This request ID has already been processed');
    const [, assistant] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId, role: MessageRole.USER, content: dto.content, status: MessageStatus.COMPLETED } }),
      this.prisma.message.create({ data: { conversationId, role: MessageRole.ASSISTANT, content: '', status: MessageStatus.STREAMING, modelId: model.id, requestId } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), ...(conversation.title === 'New conversation' ? { title: dto.content.slice(0, 70) } : {}) } }),
    ]);
    const history = toGatewayHistory((await this.prisma.message.findMany({ where: { conversationId, id: { not: assistant.id } }, orderBy: { createdAt: 'desc' }, take: 50 })).reverse());
    const input = history.map((message) => message.content).join(' ');

    response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    const aborter = new AbortController();
    response.on('close', () => { if (!response.writableEnded) aborter.abort(); });
    const started = Date.now();
    let content = '';
    let status: RequestStatus = RequestStatus.STREAMING;
    let usage;
    try {
      usage = await this.gateway.stream(
        model.id,
        history,
        aborter.signal,
        (text) => { content += text; response.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`); },
      );
      status = RequestStatus.COMPLETED;
      await this.prisma.message.update({ where: { id: assistant.id }, data: { content, status: MessageStatus.COMPLETED } });
      await this.usage.record({ requestId, userId: user.id, conversationId, model, input, output: content, durationMs: Date.now() - started, status, usage });
      response.write(`event: done\ndata: ${JSON.stringify({ requestId, messageId: assistant.id })}\n\n`);
      response.end();
    } catch (error) {
      const cancelled = aborter.signal.aborted;
      status = cancelled ? RequestStatus.CANCELLED : RequestStatus.ERROR;
      await this.prisma.message.update({ where: { id: assistant.id }, data: { content, status: cancelled ? MessageStatus.INTERRUPTED : MessageStatus.ERROR } });
      await this.usage.record({ requestId, userId: user.id, conversationId, model, input, output: content, durationMs: Date.now() - started, status, usage }).catch(() => undefined);
      if (!cancelled && !response.writableEnded) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'Generation failed' })}\n\n`);
        response.end();
      }
    }
  }
}
