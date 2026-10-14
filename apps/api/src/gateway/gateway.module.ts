import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';

/** The only inference boundary; replacing LiteLLM means replacing this module. */
@Module({ providers: [GatewayService], exports: [GatewayService] })
export class GatewayModule {}
