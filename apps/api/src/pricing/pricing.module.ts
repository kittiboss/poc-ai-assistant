import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { PricingService } from './pricing.service';

@Module({ imports: [UsersModule, AuditModule], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}
