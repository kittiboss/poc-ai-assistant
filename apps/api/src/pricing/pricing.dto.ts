import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const STRATEGIES = ['PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION'] as const;
const RATE = 'Currency units per one million tokens, as a decimal string.';

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
