import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthGuard } from './common/auth/auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { ConversationsModule } from './conversations/conversations.module';
import { HealthModule } from './health/health.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ModelsModule } from './models/models.module';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    HealthModule,
    ModelsModule,
    ConversationsModule,
    KnowledgeModule,
    UsageModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
