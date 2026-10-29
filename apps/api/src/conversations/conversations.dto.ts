import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments/attachments.service';
import { NULLABLE_UUID } from '../common/swagger/schema-types';

export class CreateConversationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120, example: 'Quarterly planning notes', description: 'Defaults to "New conversation"; the first message renames an untitled conversation.' })
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
}
export class UpdateConversationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120, example: 'Renamed conversation' })
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
  @ApiPropertyOptional(NULLABLE_UUID) @IsOptional() @IsUUID() projectId?: string | null;
}
export class SendMessageDto {
  @ApiProperty({ maxLength: 20000, example: 'Explain Docker Compose', description: 'May be empty when attachmentIds lists a file.' })
  @IsString() @MaxLength(20000) content!: string;
  @ApiProperty({ example: 'local-mock', description: 'A model ID from GET /models that is available to the caller.' })
  @IsString() modelId!: string;
  @ApiPropertyOptional({ example: '0b5c2a8e-4b0f-4d0e-9a51-7a3f3f1c2d10', description: 'Idempotency key. A request ID that was already processed is rejected, so retries never double-count usage. Generated when omitted.' })
  @IsOptional() @IsString() requestId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() templateId?: string;
  @ApiPropertyOptional({ description: 'Acknowledge regex warnings for the complete outgoing context.' }) @IsOptional() @IsBoolean() acknowledgeSensitive?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Retrieve matching products from the indexed catalog and supply them as cited context. With an external embedding model the message text is sent to that provider for the search.' }) @IsOptional() @IsBoolean() useProductCatalog?: boolean;
  @ApiPropertyOptional({ default: false, description: "Retrieve matching passages from your organization's knowledge base (the central knowledge base in vendor-managed deployments, otherwise the product catalog) and supply them as cited context." }) @IsOptional() @IsBoolean() useKnowledge?: boolean;
  @ApiPropertyOptional({ type: String, isArray: true, format: 'uuid', maxItems: MAX_ATTACHMENTS_PER_MESSAGE, description: 'Files from POST /attachments to send with this message. Every file attached in the chat stays in the model context.' })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE) @ArrayUnique() @IsUUID(undefined, { each: true }) attachmentIds?: string[];
  @ApiPropertyOptional({ enum: ['th', 'en'], description: 'Language of the overview when the message only sends files; without it, the language of the files.' })
  @IsOptional() @IsIn(['th', 'en']) locale?: 'th' | 'en';
}
