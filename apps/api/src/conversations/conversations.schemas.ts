import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageRole, MessageStatus } from '@prisma/client';
import { DATE, NULLABLE_STRING } from '../common/swagger/schema-types';

export class ConversationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: 'New conversation' }) title!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
  @ApiPropertyOptional({ ...DATE, nullable: true }) deletedAt?: string | null;
}

class MessageCount { @ApiProperty({ example: 4 }) messages!: number; }

export class ConversationSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Explain Docker Compose' }) title!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
  @ApiProperty({ type: () => MessageCount }) _count!: MessageCount;
}

export class MessageView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ enum: MessageRole }) role!: MessageRole;
  @ApiProperty({ example: 'This is a mock AI response for local POC testing.' }) content!: string;
  @ApiProperty({ enum: MessageStatus, description: 'INTERRUPTED keeps partial content after cancellation or an API restart.' }) status!: MessageStatus;
  @ApiProperty({ ...NULLABLE_STRING, example: 'local-mock' }) modelId!: string | null;
  @ApiProperty({ ...NULLABLE_STRING, description: 'Set on assistant messages; matches the usage record.' }) requestId!: string | null;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
}

export class ConversationDetail extends ConversationView {
  @ApiProperty({ type: [MessageView] }) messages!: MessageView[];
}
