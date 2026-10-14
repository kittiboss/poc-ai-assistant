import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GatewayModule } from '../gateway/gateway.module';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';

@Module({ imports: [UsersModule, GatewayModule, UsageModule, AuditModule], controllers: [ModelsController], providers: [ModelsService], exports: [ModelsService] })
export class ModelsModule {}
