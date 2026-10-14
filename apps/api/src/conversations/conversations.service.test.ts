import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { auth, basePrisma, localUser, usersWith } from '../testing/fixtures';
import { ConversationsService } from './conversations.service';

describe('conversation persistence and ownership', () => {
  it('scopes conversation reads to the authenticated Keycloak subject', async () => {
    const prisma = { ...basePrisma(), conversation: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new ConversationsService(prisma as never, usersWith(prisma));
    await expect(service.get(auth, '10000000-0000-0000-0000-000000000001')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: expect.any(String), userId: localUser.id, deletedAt: null } }));
  });

  it('persists chats and soft-deletes them so historical usage remains referentially intact', async () => {
    const created = { id: 'conversation-1', userId: localUser.id, title: 'Saved chat' };
    const prisma = { ...basePrisma(), conversation: {
      create: vi.fn().mockResolvedValue(created),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const service = new ConversationsService(prisma as never, usersWith(prisma));
    await expect(service.create(auth, 'Saved chat')).resolves.toEqual(created);
    await service.remove(auth, created.id);
    expect(prisma.conversation.create).toHaveBeenCalledWith({ data: { userId: localUser.id, title: 'Saved chat' } });
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: expect.any(Date) } }));
  });
});
