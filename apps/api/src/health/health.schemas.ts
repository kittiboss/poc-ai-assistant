import { ApiProperty } from '@nestjs/swagger';

export class HealthResponse {
  @ApiProperty({ example: 'ok' }) status!: string;
  @ApiProperty({ example: 'enterprise-ai-api' }) service!: string;
  @ApiProperty({ description: 'Server-wide external provider switch (ENABLE_EXTERNAL_PROVIDERS).' }) externalProvidersEnabled!: boolean;
}
