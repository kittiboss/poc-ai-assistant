import { ApiProperty } from '@nestjs/swagger';
import { Provider } from '@prisma/client';
import { DATE } from '../common/swagger/schema-types';

export class ModelView {
  @ApiProperty({ example: 'local-mock' }) id!: string;
  @ApiProperty({ example: 'Local Mock' }) displayName!: string;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty({ example: 'mock-enterprise' }) providerModelId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: 'Role default or explicit per-user permission.' }) permitted!: boolean;
  @ApiProperty({ description: 'Enabled, permitted, configured, within the external daily limit, and routed by the gateway.' }) available!: boolean;
  @ApiProperty({ description: 'Local models have $0 external API cost.' }) local!: boolean;
  @ApiProperty({ example: 8192 }) contextWindow!: number;
  @ApiProperty({ type: [String], example: ['chat', 'streaming'] }) capabilities!: string[];
  @ApiProperty({ enum: ['Disabled', 'Not permitted', 'Not configured', 'Daily limit reached', 'Available', 'Unavailable'] }) status!: string;
}

export class AIModelView {
  @ApiProperty({ example: 'google-gemini' }) id!: string;
  @ApiProperty({ example: 'Gemini 3.5 Flash-Lite' }) displayName!: string;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty({ example: 'gemini-3.5-flash-lite' }) providerModelId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: [String], example: ['ADMIN'] }) allowedRoles!: string[];
  @ApiProperty() contextWindow!: number;
  @ApiProperty({ type: [String] }) capabilities!: string[];
  @ApiProperty() local!: boolean;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
}
