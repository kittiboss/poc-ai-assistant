import { ApiProperty } from '@nestjs/swagger';
import { Provider, RequestStatus, UsageKind } from '@prisma/client';
import { DATE, DECIMAL, NULLABLE_DECIMAL } from '../common/swagger/schema-types';

export class TokenSum { @ApiProperty({ nullable: true, example: 437 }) totalTokens!: number | null; }

class UsageTotalsSum {
  @ApiProperty({ nullable: true }) inputTokens!: number | null;
  @ApiProperty({ nullable: true }) outputTokens!: number | null;
  @ApiProperty({ nullable: true }) totalTokens!: number | null;
  @ApiProperty({ ...NULLABLE_DECIMAL, description: 'Externally payable amount.' }) actualProviderCost!: string | null;
  @ApiProperty(NULLABLE_DECIMAL) customerCharge!: string | null;
  @ApiProperty({ ...NULLABLE_DECIMAL, description: 'Scenario only; never payable.' }) simulatedProviderCost!: string | null;
  @ApiProperty({ ...NULLABLE_DECIMAL, description: 'Scenario only; never invoiced.' }) simulatedCustomerCharge!: string | null;
}

class UsageTotals {
  @ApiProperty({ example: 17 }) _count!: number;
  @ApiProperty({ type: () => UsageTotalsSum }) _sum!: UsageTotalsSum;
}

class UsageByModel {
  @ApiProperty({ example: 'local-mock' }) modelId!: string;
  @ApiProperty() _count!: number;
  @ApiProperty({ type: () => TokenSum }) _sum!: TokenSum;
}

class ModelName { @ApiProperty({ example: 'Local Mock' }) displayName!: string; }

export class UsageRecordView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ example: 'local-mock' }) modelId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Pricing version used for the snapshot below.' }) pricingVersionId!: string | null;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ enum: RequestStatus }) status!: RequestStatus;
  @ApiProperty({ enum: UsageKind, description: 'ACTUAL from provider metadata, ESTIMATED when absent, SYNTHETIC for the mock.' }) usageKind!: UsageKind;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty(DECIMAL) actualProviderCost!: string;
  @ApiProperty(DECIMAL) customerCharge!: string;
  @ApiProperty(DECIMAL) simulatedProviderCost!: string;
  @ApiProperty(DECIMAL) simulatedCustomerCharge!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Immutable copy of the rates used.' }) pricingSnapshot!: Record<string, unknown>;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => ModelName }) model!: ModelName;
}

export class MyUsageResponse {
  @ApiProperty({ type: () => UsageTotals }) totals!: UsageTotals;
  @ApiProperty({ type: [UsageByModel] }) byModel!: UsageByModel[];
  @ApiProperty({ type: [UsageRecordView], description: 'Latest 100 requests; prompt and response content are never included.' }) records!: UsageRecordView[];
}
