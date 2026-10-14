import { ApiProperty } from '@nestjs/swagger';
import { Provider, UsageKind } from '@prisma/client';
import { DATE, NULLABLE_DECIMAL } from '../common/swagger/schema-types';
import { AIModelView } from '../models/models.schemas';
import { PricingVersionView } from '../pricing/pricing.schemas';
import { TokenSum } from '../usage/usage.schemas';

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
