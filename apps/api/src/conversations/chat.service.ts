import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { MessageRole, MessageStatus, RequestStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  GatewayService,
  gatewayErrorCode,
  refusedByGateway,
} from "../gateway/gateway.service";
import { ModelsService } from "../models/models.service";
import { UsageService } from "../usage/usage.service";
import { UsersService } from "../users/users.service";
import { toGatewayHistory } from "./chat-history";
import type { SendMessageDto } from "./conversations.dto";
import { ConversationsService } from "./conversations.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GovernanceService } from "../workspace/governance.service";
import type { GatewayMessage } from "../gateway/gateway.service";
import type { ToolDto } from "../workspace/workspace.dto";
import { KnowledgeService } from "../knowledge/knowledge.service";

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
    private readonly workspace: WorkspaceService,
    private readonly governance: GovernanceService,
    private readonly knowledge: KnowledgeService,
  ) {}

  onModuleInit() {
    void this.interruptStaleStreams();
    this.sweepTimer = setInterval(
      () => void this.interruptStaleStreams(),
      60_000,
    );
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer);
  }

  async runTool(auth: AuthUser, conversationId: string, dto: ToolDto) {
    const user = await this.users.syncUser(auth);
    const conversation = await this.conversations.owned(
      user.id,
      conversationId,
    );
    const result = await this.workspace.tool(auth, {
      ...dto,
      projectId: conversation.projectId || undefined,
    });
    const citations =
      "sources" in result && result.sources
        ? result.sources.map((source, index) => ({
            ...source,
            label: `S${index + 1}`,
          }))
        : [];
    await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          role: "USER",
          content: `/${dto.tool} ${dto.input || ""}`.trim(),
          metadata: { tool: dto.tool },
          createdAt: new Date(),
        },
      }),
      this.prisma.message.create({
        data: {
          conversationId,
          role: "ASSISTANT",
          content: result.text.slice(0, 20000),
          metadata: {
            tool: dto.tool,
            ...("filename" in result
              ? {
                  filename: result.filename,
                  content: result.content,
                  mime: result.mime,
                }
              : {}),
          },
          citations,
          createdAt: new Date(Date.now() + 1),
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          ...(conversation.title === "New conversation"
            ? { title: `${dto.tool}: ${dto.input || ""}`.slice(0, 70) }
            : {}),
        },
      }),
    ]);
    return this.conversations.get(auth, conversationId);
  }

  /** SSE streams do not survive an API restart; mark abandoned assistant messages instead of leaving them STREAMING forever. */
  async interruptStaleStreams(now = Date.now()) {
    try {
      const { count } = await this.prisma.message.updateMany({
        where: {
          status: { in: [MessageStatus.PENDING, MessageStatus.STREAMING] },
          updatedAt: { lt: new Date(now - STALE_STREAM_MS) },
        },
        data: { status: MessageStatus.INTERRUPTED },
      });
      if (count)
        this.logger.warn(
          `Marked ${count} abandoned streaming message(s) as INTERRUPTED`,
        );
      return count;
    } catch (error) {
      this.logger.error(
        `Stale stream sweep failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  async stream(
    auth: AuthUser,
    conversationId: string,
    dto: SendMessageDto,
    response: Response,
  ) {
    const user = await this.users.syncUser(auth);
    const conversation = await this.conversations.owned(
      user.id,
      conversationId,
    );
    const model = await this.models.resolveForChat(
      user.id,
      auth.roles,
      dto.modelId,
    );
    const requestId = dto.requestId || randomUUID();
    const [duplicateUsage, duplicateMessage] = await Promise.all([
      this.prisma.usageRecord.findUnique({ where: { requestId } }),
      this.prisma.message.findUnique({ where: { requestId } }),
    ]);
    if (duplicateUsage || duplicateMessage)
      throw new BadRequestException(
        "This request ID has already been processed",
      );
    if (!dto.content.trim())
      throw new BadRequestException("Message cannot be empty");
    // Retrieval runs before anything is persisted, so a failed search leaves no half-written turn.
    const productCitations = dto.useProductCatalog
      ? await this.knowledge.retrieve({
          userId: user.id,
          roles: auth.roles,
          query: dto.content,
          conversationId,
          requestId,
          acknowledgeSensitive: dto.acknowledgeSensitive,
        })
      : [];
    const context = await this.workspace.context(
      user.id,
      auth.roles,
      conversation.projectId,
      dto.content,
      model.id,
      dto.templateId,
      productCitations,
    );
    const previous = toGatewayHistory(
      (
        await this.prisma.message.findMany({
          where: { conversationId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 49,
        })
      )
        .reverse()
        .filter(
          (message) =>
            !(
              message.metadata &&
              typeof message.metadata === "object" &&
              !Array.isArray(message.metadata) &&
              "tool" in message.metadata
            ),
        ),
    );
    const history: GatewayMessage[] = [
      { role: "system", content: context.instructions },
      ...previous,
      { role: "user", content: dto.content },
    ];
    const input = history.map((m) => m.content).join("\n");
    const maxOutputTokens = Math.min(
      context.maxOutputTokens ?? this.gateway.maxOutputTokens(),
      this.gateway.maxOutputTokens(),
    );
    if (
      Buffer.byteLength(input, "utf8") + maxOutputTokens + 512 >
      model.contextWindow
    )
      throw new BadRequestException(
        "This conversation exceeds the conservative context limit. Start a new chat with a shorter prompt.",
      );
    if (!model.local)
      await this.governance.checkSensitive(input, dto.acknowledgeSensitive);
    await this.governance.reserve({
      requestId,
      userId: user.id,
      modelId: model.id,
      roles: auth.roles,
      external: !model.local,
      input,
      outputTokens: maxOutputTokens,
    });
    try {
      const [, assistant] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            conversationId,
            role: MessageRole.USER,
            content: dto.content,
            status: MessageStatus.COMPLETED,
            createdAt: new Date(),
          },
        }),
        this.prisma.message.create({
          data: {
            conversationId,
            role: MessageRole.ASSISTANT,
            content: "",
            status: MessageStatus.STREAMING,
            modelId: model.id,
            requestId,
            citations: context.citations,
            metadata: { templateId: dto.templateId || null },
            createdAt: new Date(Date.now() + 1),
          },
        }),
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: new Date(),
            ...(conversation.title === "New conversation"
              ? { title: dto.content.slice(0, 70) }
              : {}),
          },
        }),
      ]);

      response.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      const aborter = new AbortController();
      let stopReason = "";
      const timeout = setTimeout(() => {
        stopReason = "Generation timed out";
        aborter.abort();
      }, 120_000);
      const killCheck = !model.local
        ? setInterval(() => {
            void this.governance
              .settings()
              .then((settings) => {
                if (settings.externalBlocked) {
                  stopReason = "External generation stopped by administrator";
                  aborter.abort();
                }
              })
              .catch(() => {
                stopReason = "Could not verify external-provider policy";
                aborter.abort();
              });
          }, 1500)
        : undefined;
      response.on("close", () => {
        if (!response.writableEnded) aborter.abort();
      });
      const started = Date.now();
      let content = "";
      let status: RequestStatus = RequestStatus.STREAMING;
      let usage;
      try {
        usage = await this.gateway.stream(
          model.id,
          history,
          aborter.signal,
          (text) => {
            content += text;
            response.write(
              `event: token\ndata: ${JSON.stringify({ text })}\n\n`,
            );
          },
          { temperature: context.temperature, maxOutputTokens, requestId },
        );
        status = RequestStatus.COMPLETED;
        await this.prisma.message.update({
          where: { id: assistant.id },
          data: { content, status: MessageStatus.COMPLETED },
        });
        await this.usage.record({
          requestId,
          userId: user.id,
          conversationId,
          model,
          input,
          output: content,
          durationMs: Date.now() - started,
          status,
          usage,
        });
        response.write(
          `event: done\ndata: ${JSON.stringify({ requestId, messageId: assistant.id, citations: context.citations })}\n\n`,
        );
        response.end();
      } catch (error) {
        const cancelled = aborter.signal.aborted;
        status = cancelled ? RequestStatus.CANCELLED : RequestStatus.ERROR;
        await this.prisma.message.update({
          where: { id: assistant.id },
          data: {
            content,
            status: cancelled ? MessageStatus.INTERRUPTED : MessageStatus.ERROR,
          },
        });
        await this.usage
          .record({
            requestId,
            userId: user.id,
            conversationId,
            model,
            input,
            output: content,
            durationMs: Date.now() - started,
            status,
            // Refused before any text (no credit, rate limit): nothing was processed or billed.
            usage:
              refusedByGateway(error) && !content
                ? { prompt_tokens: 0, completion_tokens: 0 }
                : usage,
          })
          .catch(() => undefined);
        if ((!cancelled || stopReason) && !response.writableEnded) {
          // `code` lets the web show its own message (e.g. credit used up) instead of the server's wording.
          response.write(
            `event: error\ndata: ${JSON.stringify({ message: stopReason || (error instanceof Error ? error.message : "Generation failed"), code: stopReason ? undefined : gatewayErrorCode(error) })}\n\n`,
          );
          response.end();
        }
      } finally {
        clearTimeout(timeout);
        clearInterval(killCheck);
      }
    } finally {
      await this.governance.release(requestId);
    }
  }
}
