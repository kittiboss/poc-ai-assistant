import { Injectable } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mirrors the verified Keycloak subject and current roles locally. Passwords stay in Keycloak. */
  async syncUser(auth: AuthUser) {
    const user = await this.prisma.user.upsert({
      where: { externalId: auth.sub },
      update: { username: auth.username, email: auth.email },
      create: {
        externalId: auth.sub,
        username: auth.username,
        email: auth.email,
      },
    });
    const roles = await this.prisma.role.findMany({
      where: { name: { in: auth.roles } },
    });
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: user.id, roleId: { notIn: roles.map((r) => r.id) } },
      }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId: user.id, roleId: role.id })),
        skipDuplicates: true,
      }),
    ]);
    return user;
  }

  /** Read-only fast path for polling endpoints; a first-time user is still mirrored safely. */
  async findOrSyncUser(auth: AuthUser) {
    return (
      (await this.prisma.user.findUnique({
        where: { externalId: auth.sub },
      })) || (await this.syncUser(auth))
    );
  }
}
