import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { UpdateConversationDto } from "./conversations.dto";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import { UsersService } from "../users/users.service";

/** Every query is scoped to the user mirrored from the verified token subject. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async create(auth: AuthUser, title?: string, projectId?: string) {
    const user = await this.users.syncUser(auth);
    if (projectId) await this.projectOwned(user.id, projectId);
    return this.prisma.conversation.create({
      data: {
        userId: user.id,
        title: title?.trim() || "New conversation",
        ...(projectId ? { projectId } : {}),
      },
    });
  }

  async list(
    auth: AuthUser,
    search?: string,
    projectId?: string,
    archived = false,
  ) {
    const user = await this.users.syncUser(auth);
    let ids: string[] | undefined;
    if (search?.trim()) {
      const query = search.trim().slice(0, 200);
      const matches = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Conversation" c WHERE c."userId" = ${user.id}::uuid AND c."deletedAt" IS NULL
        AND (strpos(lower(c.title), lower(${query})) > 0 OR EXISTS (
          SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id
          AND (to_tsvector('simple', m.content) @@ plainto_tsquery('simple', ${query}) OR strpos(lower(m.content), lower(${query})) > 0)))`;
      ids = matches.map((m) => m.id);
    }
    return this.prisma.conversation.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        archived,
        ...(projectId ? { projectId } : {}),
        ...(ids ? { id: { in: ids } } : {}),
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        projectId: true,
        pinned: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const user = await this.users.syncUser(auth);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    const requestIds = conversation.messages
      .map((m) => m.requestId)
      .filter((id): id is string => Boolean(id));
    const usage = requestIds.length
      ? await this.prisma.usageRecord.findMany({
          where: { userId: user.id, requestId: { in: requestIds } },
        })
      : [];
    return {
      ...conversation,
      messages: conversation.messages.map((m) => ({
        ...m,
        usage: usage.find((u) => u.requestId === m.requestId),
      })),
    };
  }

  async rename(auth: AuthUser, id: string, title: string) {
    const user = await this.users.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { title: title.trim() },
    });
    if (!result.count) throw new NotFoundException("Conversation not found");
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  private async projectOwned(userId: string, id: string) {
    if (!(await this.prisma.project.findFirst({ where: { id, userId } })))
      throw new NotFoundException("Project not found");
  }
  async update(auth: AuthUser, id: string, data: UpdateConversationDto) {
    const user = await this.users.syncUser(auth);
    await this.owned(user.id, id);
    if (data.projectId) await this.projectOwned(user.id, data.projectId);
    if (data.title !== undefined && !data.title.trim())
      throw new BadRequestException("Title is required");
    return this.prisma.conversation.update({ where: { id }, data });
  }
  async branch(auth: AuthUser, id: string, messageId: string, before = false) {
    const conversation = await this.get(auth, id);
    const index = conversation.messages.findIndex((m) => m.id === messageId);
    if (index < 0) throw new NotFoundException("Message not found");
    const messages = conversation.messages
      .slice(0, index + (before ? 0 : 1))
      .filter((m) => m.status === "COMPLETED" || m.status === "INTERRUPTED");
    return this.prisma.conversation.create({
      data: {
        userId: conversation.userId,
        projectId: conversation.projectId,
        title: `${conversation.title.slice(0, 100)} (branch)`,
        messages: {
          create: messages.map((m, i) => ({
            role: m.role,
            content: m.content,
            status: m.status,
            modelId: m.modelId,
            citations: m.citations as Prisma.InputJsonValue,
            metadata: {
              ...(m.metadata &&
              typeof m.metadata === "object" &&
              !Array.isArray(m.metadata)
                ? m.metadata
                : {}),
              branchedFrom: m.id,
            },
            createdAt: new Date(Date.now() - messages.length + i),
          })),
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }
  async feedback(
    auth: AuthUser,
    id: string,
    messageId: string,
    rating: number,
    comment?: string,
  ) {
    const user = await this.users.syncUser(auth);
    await this.owned(user.id, id);
    const result = await this.prisma.message.updateMany({
      where: { id: messageId, conversationId: id, role: "ASSISTANT" },
      data: { feedback: rating, feedbackComment: comment || null },
    });
    if (!result.count)
      throw new NotFoundException("Assistant message not found");
    return { rating, comment };
  }

  /** Soft delete, so usage records and their pricing references stay intact. */
  async remove(auth: AuthUser, id: string) {
    const user = await this.users.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("Conversation not found");
  }

  async owned(userId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }
}
