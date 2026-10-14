import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({ imports: [UsersModule, PricingModule], controllers: [UsageController], providers: [UsageService], exports: [UsageService] })
export class UsageModule {}
