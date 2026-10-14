import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/auth.decorators';
import { HealthResponse } from './health.schemas';

@ApiTags('health')
@Controller()
export class HealthController {
  @ApiOperation({ summary: 'Liveness check', description: 'Public. Never calls a model provider.', security: [] })
  @ApiOkResponse({ type: HealthResponse })
  @Public() @Get('health') health() {
    return {
      status: 'ok',
      service: 'enterprise-ai-api',
      externalProvidersEnabled: process.env.ENABLE_EXTERNAL_PROVIDERS === 'true',
    };
  }
}
