import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { VendorResponseInterceptor } from './common/vendor-response.interceptor';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AttachmentsModule } from './attachments/attachments.module';
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
    AttachmentsModule,
    KnowledgeModule,
    UsageModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: VendorResponseInterceptor },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
