import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export type AuditEntry = { actorId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry) {
    return this.prisma.auditLog.create({ data: {
      actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
      before: entry.before as Prisma.InputJsonValue | undefined, after: entry.after as Prisma.InputJsonValue | undefined,
    } });
  }

  latest(entityType?: string) {
    return this.prisma.auditLog.findMany({
      where: entityType ? { entityType } : {}, orderBy: { createdAt: 'desc' }, take: 100,
      include: { actor: { select: { username: true } } },
    });
  }
}
