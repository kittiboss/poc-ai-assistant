import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';

/** Every query is scoped to the user mirrored from the verified token subject. */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService, private readonly users: UsersService) {}

  async create(auth: AuthUser, title?: string) {
    const user = await this.users.syncUser(auth);
    return this.prisma.conversation.create({ data: { userId: user.id, title: title?.trim() || 'New conversation' } });
  }

  async list(auth: AuthUser, search?: string) {
    const user = await this.users.syncUser(auth);
    return this.prisma.conversation.findMany({
      where: { userId: user.id, deletedAt: null, ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
  }

  async get(auth: AuthUser, id: string) {
    const user = await this.users.syncUser(auth);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId: user.id, deletedAt: null }, include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async rename(auth: AuthUser, id: string, title: string) {
    const user = await this.users.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { title: title.trim() } });
    if (!result.count) throw new NotFoundException('Conversation not found');
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  /** Soft delete, so usage records and their pricing references stay intact. */
  async remove(auth: AuthUser, id: string) {
    const user = await this.users.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Conversation not found');
  }

  async owned(userId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id, userId, deletedAt: null } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
