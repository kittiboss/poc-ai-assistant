import { vi } from 'vitest';
import { UsersService } from '../users/users.service';

export const auth = { sub: 'kc-user-1', username: 'employee1', roles: ['USER'] };
export const admin = { sub: 'kc-admin', username: 'admin', roles: ['ADMIN', 'USER'] };
export const localUser = { id: '00000000-0000-0000-0000-000000000001', externalId: auth.sub, username: auth.username };

/** Prisma calls made by UsersService.syncUser for every authenticated request. */
export function basePrisma() {
  return {
    user: { upsert: vi.fn().mockResolvedValue(localUser) },
    role: { findMany: vi.fn().mockResolvedValue([]) },
    userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}

export const usersWith = (prisma: unknown) => new UsersService(prisma as never);
