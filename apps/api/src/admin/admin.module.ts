import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ModelsModule } from '../models/models.module';
import { PricingModule } from '../pricing/pricing.module';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({ imports: [UsersModule, UsageModule, ModelsModule, PricingModule, AuditModule, GatewayModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
