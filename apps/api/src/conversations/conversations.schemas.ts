import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageRole, MessageStatus, UsageKind } from '@prisma/client';
import { DATE, DECIMAL, NULLABLE_INT, NULLABLE_STRING, NULLABLE_UUID } from '../common/swagger/schema-types';

export class ConversationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: 'New conversation' }) title!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
  @ApiPropertyOptional({ ...DATE, nullable: true }) deletedAt?: string | null;
  @ApiProperty({ example: false, description: 'Pinned chats are listed first.' }) pinned!: boolean;
  @ApiProperty({ example: false, description: 'Archived chats are listed only with archived=true.' }) archived!: boolean;
  @ApiProperty({ ...NULLABLE_UUID, description: 'Private project whose sources and instructions the chat uses.' }) projectId!: string | null;
}

class MessageCount { @ApiProperty({ example: 4 }) messages!: number; }

export class ConversationSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Explain Docker Compose' }) title!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
  @ApiProperty({ example: false }) pinned!: boolean;
  @ApiProperty({ example: false }) archived!: boolean;
  @ApiProperty(NULLABLE_UUID) projectId!: string | null;
  @ApiProperty({ type: () => MessageCount }) _count!: MessageCount;
}

class CitationView {
  @ApiProperty({ format: 'uuid', description: 'Source chunk ID.' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ example: 'leave-policy.pdf' }) filename!: string;
  @ApiProperty({ ...NULLABLE_INT, description: 'PDF page, when known.' }) page!: number | null;
  @ApiProperty({ description: 'The retrieved excerpt.' }) content!: string;
  @ApiProperty({ example: 'S1', description: 'The label the reply cites, e.g. [S1].' }) label!: string;
}

class MessageMetadata {
  @ApiPropertyOptional({ description: 'Local tool that produced this message; no model was called.' }) tool?: string;
  @ApiPropertyOptional({ description: 'File offered for download with this message.' }) filename?: string;
  @ApiPropertyOptional({ description: 'Content of that file.' }) content?: string;
  @ApiPropertyOptional({ example: 'text/csv' }) mime?: string;
}

class MessageUsage {
  @ApiProperty({ type: 'integer' }) inputTokens!: number;
  @ApiProperty({ type: 'integer' }) outputTokens!: number;
  @ApiProperty({ type: 'integer' }) durationMs!: number;
  @ApiProperty({ enum: UsageKind }) usageKind!: UsageKind;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty(DECIMAL) actualProviderCost!: string;
  @ApiProperty(DECIMAL) customerCharge!: string;
}

export class MessageView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ enum: MessageRole }) role!: MessageRole;
  @ApiProperty({ example: 'This is a mock AI response for local POC testing.' }) content!: string;
  @ApiProperty({ enum: MessageStatus, description: 'INTERRUPTED keeps partial content after cancellation or an API restart.' }) status!: MessageStatus;
  @ApiProperty({ ...NULLABLE_STRING, example: 'local-mock' }) modelId!: string | null;
  @ApiProperty({ ...NULLABLE_STRING, description: 'Set on assistant messages; matches the usage record.' }) requestId!: string | null;
  @ApiProperty({ type: [CitationView], description: 'Project sources retrieved for this reply.' }) citations!: CitationView[];
  @ApiProperty({ type: () => MessageMetadata }) metadata!: MessageMetadata;
  @ApiProperty({ ...NULLABLE_INT, enum: [-1, 1], description: 'The owner\'s rating of an assistant reply.' }) feedback!: number | null;
  @ApiProperty(NULLABLE_STRING) feedbackComment!: string | null;
  @ApiPropertyOptional({ type: () => MessageUsage, description: 'Usage and cost of the request that produced this reply.' }) usage?: MessageUsage;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
}

export class ConversationDetail extends ConversationView {
  @ApiProperty({ type: [MessageView] }) messages!: MessageView[];
}
