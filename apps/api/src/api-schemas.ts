import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageRole, MessageStatus, PricingStrategy, Provider, RequestStatus, UsageKind } from '@prisma/client';

// OpenAPI response shapes. They document what the services return; the services
// themselves return Prisma results. Decimal columns serialize as strings.
const DECIMAL = { type: String, format: 'decimal', example: '0.000000000000' } as const;
const NULLABLE_DECIMAL = { ...DECIMAL, nullable: true } as const;
const DATE = { type: String, format: 'date-time' } as const;

export class ErrorResponse {
  @ApiProperty({ example: 404 }) statusCode!: number;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], example: 'Conversation not found' }) message!: string | string[];
  @ApiPropertyOptional({ example: 'Not Found' }) error?: string;
}

export class HealthResponse {
  @ApiProperty({ example: 'ok' }) status!: string;
  @ApiProperty({ example: 'enterprise-ai-api' }) service!: string;
  @ApiProperty({ description: 'Server-wide external provider switch (ENABLE_EXTERNAL_PROVIDERS).' }) externalProvidersEnabled!: boolean;
}

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
  @ApiProperty({ nullable: true, example: 'local-mock' }) modelId!: string | null;
  @ApiProperty({ nullable: true, description: 'Set on assistant messages; matches the usage record.' }) requestId!: string | null;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty(DATE) updatedAt!: string;
}

export class ConversationDetail extends ConversationView {
  @ApiProperty({ type: [MessageView] }) messages!: MessageView[];
}

class TokenSum { @ApiProperty({ nullable: true, example: 437 }) totalTokens!: number | null; }

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

class CostSum extends TokenSum {
  @ApiProperty(NULLABLE_DECIMAL) actualProviderCost!: string | null;
  @ApiProperty(NULLABLE_DECIMAL) customerCharge!: string | null;
  @ApiProperty(NULLABLE_DECIMAL) simulatedProviderCost!: string | null;
  @ApiProperty(NULLABLE_DECIMAL) simulatedCustomerCharge!: string | null;
}

class ProviderBreakdown {
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() _count!: number;
  @ApiProperty({ type: () => CostSum }) _sum!: CostSum;
}

class ModelBreakdown {
  @ApiProperty({ example: 'local-mock' }) modelId!: string;
  @ApiProperty({ example: 'Local Mock' }) displayName!: string;
  @ApiProperty() _count!: number;
  @ApiProperty({ type: () => CostSum }) _sum!: CostSum;
}

class KindBreakdown {
  @ApiProperty({ enum: UsageKind }) usageKind!: UsageKind;
  @ApiProperty() _count!: number;
  @ApiProperty({ type: () => TokenSum }) _sum!: TokenSum;
}

class DailyPoint {
  @ApiProperty({ format: 'date', example: '2026-10-14' }) day!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() tokens!: number;
}

class TokenTotals {
  @ApiProperty({ nullable: true }) inputTokens!: number | null;
  @ApiProperty({ nullable: true }) outputTokens!: number | null;
  @ApiProperty({ nullable: true }) totalTokens!: number | null;
}

class ExternalUsage {
  @ApiProperty({ example: 8 }) requests!: number;
  @ApiProperty({ example: 74 }) tokens!: number;
}

class ExternalGuardrail {
  @ApiProperty({ type: () => ExternalUsage, description: 'External-provider usage today (UTC).' }) used!: ExternalUsage;
  @ApiProperty({ type: () => ExternalUsage, description: 'EXTERNAL_DAILY_REQUEST_LIMIT / EXTERNAL_DAILY_TOKEN_LIMIT.' }) limits!: ExternalUsage;
}

export class AdminSummary {
  @ApiProperty({ description: 'All users known to the installation (unfiltered).' }) users!: number;
  @ApiProperty({ description: 'Users with usage in the filtered range.' }) activeUsers!: number;
  @ApiProperty() requests!: number;
  @ApiProperty({ type: () => TokenTotals }) tokens!: TokenTotals;
  @ApiProperty({ type: [ProviderBreakdown] }) byProvider!: ProviderBreakdown[];
  @ApiProperty({ type: [ModelBreakdown] }) byModel!: ModelBreakdown[];
  @ApiProperty({ type: [KindBreakdown] }) byKind!: KindBreakdown[];
  @ApiProperty({ type: () => CostSum }) costs!: CostSum;
  @ApiProperty({ type: [DailyPoint] }) daily!: DailyPoint[];
  @ApiProperty({ type: () => ExternalGuardrail }) externalToday!: ExternalGuardrail;
}

export class PricingVersionView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) configurationId!: string;
  @ApiProperty({ example: 2 }) version!: number;
  @ApiProperty({ enum: PricingStrategy }) strategy!: PricingStrategy;
  @ApiProperty(DECIMAL) providerInputRate!: string;
  @ApiProperty(DECIMAL) providerOutputRate!: string;
  @ApiProperty(NULLABLE_DECIMAL) cachedInputRate!: string | null;
  @ApiProperty(DECIMAL) additionalFee!: string;
  @ApiProperty(DECIMAL) customerInputRate!: string;
  @ApiProperty(DECIMAL) customerOutputRate!: string;
  @ApiProperty({ ...DECIMAL, example: '50' }) markupPercent!: string;
  @ApiProperty(DECIMAL) simulationInputRate!: string;
  @ApiProperty(DECIMAL) simulationOutputRate!: string;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty(DATE) effectiveAt!: string;
  @ApiProperty({ nullable: true, description: 'Keycloak subject of the admin, or system-seed.' }) createdBy!: string | null;
  @ApiProperty(DATE) createdAt!: string;
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

class LatestPricing {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() modelId!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: [PricingVersionView], description: 'Latest version only.' }) versions!: PricingVersionView[];
}

export class AdminModelView extends AIModelView {
  @ApiProperty({ description: 'Global switch and credential present (always true for local models).' }) configured!: boolean;
  @ApiProperty({ description: 'Routed by LiteLLM (and, for Ollama, the model is pulled). Never calls a provider.' }) reachable!: boolean;
  @ApiProperty({ enum: ['Not configured', 'Unavailable', 'Available', 'Ready (disabled)'] }) status!: string;
  @ApiProperty({ type: () => LatestPricing, nullable: true }) pricing!: LatestPricing | null;
}

export class PricingConfigurationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() modelId!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => AIModelView }) model!: AIModelView;
  @ApiProperty({ type: [PricingVersionView], description: 'All versions, newest first.' }) versions!: PricingVersionView[];
}

export class PriceResultView {
  @ApiProperty({ ...DECIMAL, description: 'Actual externally payable cost.' }) actualProviderCost!: string;
  @ApiProperty(DECIMAL) customerCharge!: string;
  @ApiProperty({ ...DECIMAL, example: '0.010000000000', description: 'Scenario only.' }) simulatedProviderCost!: string;
  @ApiProperty({ ...DECIMAL, example: '0.015000000000', description: 'Scenario only; never invoiced.' }) simulatedCustomerCharge!: string;
  @ApiProperty({ ...DECIMAL, description: 'customerCharge − actualProviderCost.' }) grossMargin!: string;
}

class RoleRef { @ApiProperty({ example: 'USER' }) name!: string; }

class UserRoleView {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) roleId!: string;
  @ApiProperty({ type: () => RoleRef }) role!: RoleRef;
}

export class UserModelPermissionView {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: 'google-gemini' }) modelId!: string;
  @ApiProperty() allowed!: boolean;
}

export class AdminUserView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'employee1' }) username!: string;
  @ApiProperty({ nullable: true, example: 'employee1@enterprise.local' }) email!: string | null;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: [UserRoleView] }) roles!: UserRoleView[];
  @ApiProperty({ type: [UserModelPermissionView] }) modelPermissions!: UserModelPermissionView[];
}

class AuditActor { @ApiProperty({ example: 'admin' }) username!: string; }

export class AuditLogView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) actorId!: string | null;
  @ApiProperty({ example: 'PRICING_VERSION_CREATE' }) action!: string;
  @ApiProperty({ example: 'PricingConfiguration' }) entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) before!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) after!: Record<string, unknown> | null;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => AuditActor, nullable: true, description: 'Null for system changes such as seed upgrades.' }) actor!: AuditActor | null;
}
