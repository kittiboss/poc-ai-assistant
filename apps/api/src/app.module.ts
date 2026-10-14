import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppService } from './app.service';
import { AuthGuard } from './auth';
import { AdminController, ConversationsController, HealthController, ModelsController, UsageController } from './controllers';
import { GatewayService } from './gateway.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [HealthController, ModelsController, ConversationsController, UsageController, AdminController],
  providers: [
    PrismaService,
    GatewayService,
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

