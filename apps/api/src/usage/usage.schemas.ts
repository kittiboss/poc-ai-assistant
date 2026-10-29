import { ApiProperty } from "@nestjs/swagger";
import { Provider, RequestStatus, UsageKind } from "@prisma/client";
import {
  DATE,
  DECIMAL,
  NULLABLE_DECIMAL,
  NULLABLE_INT,
  NULLABLE_UUID,
} from "../common/swagger/schema-types";

export class TokenSum {
  @ApiProperty({ ...NULLABLE_INT, example: 437 }) totalTokens!: number | null;
}

class UsageTotalsSum {
  @ApiProperty(NULLABLE_INT) inputTokens!: number | null;
  @ApiProperty(NULLABLE_INT) outputTokens!: number | null;
  @ApiProperty(NULLABLE_INT) totalTokens!: number | null;
  @ApiProperty({
    ...NULLABLE_DECIMAL,
    description: "Externally payable amount.",
  })
  actualProviderCost!: string | null;
  @ApiProperty(NULLABLE_DECIMAL) customerCharge!: string | null;
  @ApiProperty({
    ...NULLABLE_DECIMAL,
    description: "Scenario only; never payable.",
  })
  simulatedProviderCost!: string | null;
  @ApiProperty({
    ...NULLABLE_DECIMAL,
    description: "Scenario only; never invoiced.",
  })
  simulatedCustomerCharge!: string | null;
}

class UsageTotals {
  @ApiProperty({ example: 17 }) _count!: number;
  @ApiProperty({ type: () => UsageTotalsSum }) _sum!: UsageTotalsSum;
}

class UsageByModel {
  @ApiProperty({ example: "local-mock" }) modelId!: string;
  @ApiProperty() _count!: number;
  @ApiProperty({ type: () => TokenSum }) _sum!: TokenSum;
}

class ModelName {
  @ApiProperty({ example: "Local Mock" }) displayName!: string;
}

export class UsageRecordView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "uuid" }) conversationId!: string;
  @ApiProperty({ example: "local-mock" }) modelId!: string;
  @ApiProperty({
    ...NULLABLE_UUID,
    description: "Pricing version used for the snapshot below.",
  })
  pricingVersionId!: string | null;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ enum: RequestStatus }) status!: RequestStatus;
  @ApiProperty({
    enum: UsageKind,
    description:
      "ACTUAL from provider metadata, ESTIMATED when absent, SYNTHETIC for the mock.",
  })
  usageKind!: UsageKind;
  @ApiProperty({ example: "USD" }) currency!: string;
  @ApiProperty(DECIMAL) actualProviderCost!: string;
  @ApiProperty(DECIMAL) customerCharge!: string;
  @ApiProperty(DECIMAL) simulatedProviderCost!: string;
  @ApiProperty(DECIMAL) simulatedCustomerCharge!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description: "Immutable copy of the rates used.",
  })
  pricingSnapshot!: Record<string, unknown>;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => ModelName }) model!: ModelName;
}

export class MyUsageResponse {
  @ApiProperty({ type: () => UsageTotals }) totals!: UsageTotals;
  @ApiProperty({ type: [UsageByModel] }) byModel!: UsageByModel[];
  @ApiProperty({
    type: [UsageRecordView],
    description:
      "Latest 100 requests; prompt and response content are never included.",
  })
  records!: UsageRecordView[];
}

class LiveTokenTotals {
  @ApiProperty() requests!: number;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() totalTokens!: number;
}

class LiveReservations {
  @ApiProperty({ description: "Requests currently admitted but not settled." })
  requests!: number;
  @ApiProperty({
    description: "Conservative upper-bound reservation, not consumed usage.",
  })
  reservedTokens!: number;
}

class LiveUsageRecord {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() modelId!: string;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ enum: RequestStatus }) status!: RequestStatus;
  @ApiProperty({ enum: UsageKind }) usageKind!: UsageKind;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => ModelName }) model!: ModelName;
}

export class LiveUsageResponse {
  @ApiProperty(DATE) updatedAt!: string;
  @ApiProperty({ example: 1500 }) pollAfterMs!: number;
  @ApiProperty({ type: () => LiveTokenTotals }) totals!: LiveTokenTotals;
  @ApiProperty({ type: () => LiveTokenTotals }) today!: LiveTokenTotals;
  @ApiProperty({ type: () => LiveReservations }) active!: LiveReservations;
  @ApiProperty({ type: [LiveUsageRecord] }) recent!: LiveUsageRecord[];
}

class UsageMeter {
  @ApiProperty({ description: "Completed requests or tokens today (UTC)." })
  used!: number;
  @ApiProperty({
    description:
      "Held by requests still running: conservative upper bounds, not consumed usage.",
  })
  reserved!: number;
  @ApiProperty({
    ...NULLABLE_INT,
    description: "Daily ceiling; null when none applies.",
  })
  limit!: number | null;
}

class UsageMeters {
  @ApiProperty({ type: () => UsageMeter }) requests!: UsageMeter;
  @ApiProperty({ type: () => UsageMeter }) tokens!: UsageMeter;
}

class ModelUsageView extends UsageMeters {
  @ApiProperty({ example: "groq-llama" }) modelId!: string;
  @ApiProperty({ example: "GPT-OSS 20B (Groq)" }) displayName!: string;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() local!: boolean;
  @ApiProperty({
    description: "Also counts toward the shared external-provider limit.",
  })
  external!: boolean;
}

export class ModelUsageResponse {
  @ApiProperty(DATE) updatedAt!: string;
  @ApiProperty({ example: 5000 }) pollAfterMs!: number;
  @ApiProperty({ ...DATE, description: "When today's counts start again." })
  resetsAt!: string;
  @ApiProperty({
    type: () => UsageMeters,
    description:
      "Every external model together, against the installation's daily external-provider limit.",
  })
  external!: UsageMeters;
  @ApiProperty({
    type: [ModelUsageView],
    description:
      "Each enabled model (and any other used today); limits come from MODEL quota policies.",
  })
  models!: ModelUsageView[];
}
