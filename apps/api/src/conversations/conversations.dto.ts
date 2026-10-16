import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { NULLABLE_UUID } from '../common/swagger/schema-types';

export class CreateConversationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120, example: 'Quarterly planning notes', description: 'Defaults to "New conversation"; the first message renames an untitled conversation.' })
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
}
export class UpdateConversationDto {
  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Renamed conversation' })
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
  @ApiPropertyOptional(NULLABLE_UUID) @IsOptional() @IsUUID() projectId?: string | null;
}
export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 20000, example: 'Explain Docker Compose' })
  @IsString() @Length(1, 20000) content!: string;
  @ApiProperty({ example: 'local-mock', description: 'A model ID from GET /models that is available to the caller.' })
  @IsString() modelId!: string;
  @ApiPropertyOptional({ example: '0b5c2a8e-4b0f-4d0e-9a51-7a3f3f1c2d10', description: 'Idempotency key. A request ID that was already processed is rejected, so retries never double-count usage. Generated when omitted.' })
  @IsOptional() @IsString() requestId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() templateId?: string;
  @ApiPropertyOptional({ description: 'Acknowledge regex warnings for the complete outgoing context.' }) @IsOptional() @IsBoolean() acknowledgeSensitive?: boolean;
}
