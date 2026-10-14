import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const STRATEGIES = ['PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION'] as const;
export const PROVIDERS = ['MOCK', 'OLLAMA', 'OPENAI', 'ANTHROPIC', 'GEMINI'] as const;
const RATE = 'Currency units per one million tokens, as a decimal string.';

export class CreateConversationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120, example: 'Quarterly planning notes', description: 'Defaults to "New conversation"; the first message renames an untitled conversation.' })
  @IsOptional() @IsString() @Length(1, 120) title?: string;
}
export class UpdateConversationDto {
  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Renamed conversation' })
  @IsString() @Length(1, 120) title!: string;
}
export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 20000, example: 'Explain Docker Compose' })
  @IsString() @Length(1, 20000) content!: string;
  @ApiProperty({ example: 'local-mock', description: 'A model ID from GET /models that is available to the caller.' })
  @IsString() modelId!: string;
  @ApiPropertyOptional({ example: '0b5c2a8e-4b0f-4d0e-9a51-7a3f3f1c2d10', description: 'Idempotency key. A request ID that was already processed is rejected, so retries never double-count usage. Generated when omitted.' })
  @IsOptional() @IsString() requestId?: string;
}
export class UpdateModelDto {
  @ApiPropertyOptional({ example: true, description: 'External models can be enabled only when ENABLE_EXTERNAL_PROVIDERS=true and the provider credential is configured.' })
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['ADMIN', 'USER'], isArray: true, example: ['ADMIN', 'USER'], description: 'Roles allowed by default; explicit per-user permissions override this.' })
  @IsOptional() @IsArray() @IsIn(['ADMIN', 'USER'], { each: true }) allowedRoles?: string[];
}
export class UpdatePermissionDto {
  @ApiProperty({ example: true })
  @IsBoolean() allowed!: boolean;
}
export class UpdatePricingDto {
  @ApiProperty({ enum: STRATEGIES, example: 'SIMULATION', description: 'PASS_THROUGH: charge = provider cost. PERCENTAGE_MARKUP: cost × (1 + markup). FIXED_RATE: customer rates. SIMULATION: actual charge 0; simulated cost/charge reported separately.' })
  @IsIn(STRATEGIES) strategy!: typeof STRATEGIES[number];
  @ApiProperty({ example: '0', description: `Actual provider input cost. ${RATE} Must be 0 for local models.` })
  @IsNumberString() providerInputRate!: string;
  @ApiProperty({ example: '0', description: `Actual provider output cost. ${RATE} Must be 0 for local models.` })
  @IsNumberString() providerOutputRate!: string;
  @ApiPropertyOptional({ example: '0', description: `Cached input cost where the provider supports it. ${RATE}` })
  @IsOptional() @IsNumberString() cachedInputRate?: string;
  @ApiPropertyOptional({ example: '0', description: 'Flat additional provider fee per request, in currency units.' })
  @IsOptional() @IsNumberString() additionalFee?: string;
  @ApiPropertyOptional({ example: '0', description: `Customer input price for FIXED_RATE. ${RATE}` })
  @IsOptional() @IsNumberString() customerInputRate?: string;
  @ApiPropertyOptional({ example: '0', description: `Customer output price for FIXED_RATE. ${RATE}` })
  @IsOptional() @IsNumberString() customerOutputRate?: string;
  @ApiPropertyOptional({ example: '50', description: 'Markup percent for PERCENTAGE_MARKUP and SIMULATION.' })
  @IsOptional() @IsNumberString() markupPercent?: string;
  @ApiPropertyOptional({ example: '2.5', description: `Simulated provider input cost (planning only, never billed). ${RATE}` })
  @IsOptional() @IsNumberString() simulationInputRate?: string;
  @ApiPropertyOptional({ example: '3.571428571428', description: `Simulated provider output cost (planning only, never billed). ${RATE}` })
  @IsOptional() @IsNumberString() simulationOutputRate?: string;
  @ApiProperty({ minLength: 3, maxLength: 3, example: 'USD' })
  @IsString() @Length(3, 3) currency!: string;
  @ApiPropertyOptional({ format: 'date-time', description: 'When the version takes effect; defaults to now. Future dates schedule a price change.' })
  @IsOptional() @IsDateString() effectiveAt?: string;
}
export class PreviewPricingDto extends UpdatePricingDto {
  @ApiProperty({ minimum: 0, maximum: 1000000000, example: 3000 })
  @IsInt() @Min(0) @Max(1000000000) inputTokens!: number;
  @ApiProperty({ minimum: 0, maximum: 1000000000, example: 700 })
  @IsInt() @Min(0) @Max(1000000000) outputTokens!: number;
}

export class SummaryQueryDto {
  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive lower bound on usage createdAt.' })
  @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive upper bound on usage createdAt.' })
  @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: PROVIDERS })
  @IsOptional() @IsIn(PROVIDERS) provider?: typeof PROVIDERS[number];
  @ApiPropertyOptional({ example: 'local-mock' })
  @IsOptional() @IsString() @Length(1, 100) modelId?: string;
}
export class AuditQueryDto {
  @ApiPropertyOptional({ enum: ['AIModel', 'UserModelPermission', 'PricingConfiguration'] })
  @IsOptional() @IsIn(['AIModel', 'UserModelPermission', 'PricingConfiguration']) entityType?: string;
}
