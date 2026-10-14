import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateConversationDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
}
export class UpdateConversationDto {
  @IsString() @Length(1, 120) title!: string;
}
export class SendMessageDto {
  @IsString() @Length(1, 20000) content!: string;
  @IsString() modelId!: string;
  @IsOptional() @IsString() requestId?: string;
}
export class UpdateModelDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsIn(['ADMIN', 'USER'], { each: true }) allowedRoles?: string[];
}
export class UpdatePermissionDto {
  @IsBoolean() allowed!: boolean;
}
export class UpdatePricingDto {
  @IsIn(['PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION']) strategy!: 'PASS_THROUGH' | 'PERCENTAGE_MARKUP' | 'FIXED_RATE' | 'SIMULATION';
  @IsNumberString() providerInputRate!: string;
  @IsNumberString() providerOutputRate!: string;
  @IsOptional() @IsNumberString() cachedInputRate?: string;
  @IsOptional() @IsNumberString() additionalFee?: string;
  @IsOptional() @IsNumberString() customerInputRate?: string;
  @IsOptional() @IsNumberString() customerOutputRate?: string;
  @IsOptional() @IsNumberString() markupPercent?: string;
  @IsOptional() @IsNumberString() simulationInputRate?: string;
  @IsOptional() @IsNumberString() simulationOutputRate?: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsOptional() @IsDateString() effectiveAt?: string;
}
export class PreviewPricingDto extends UpdatePricingDto {
  @IsInt() @Min(0) @Max(1000000000) inputTokens!: number;
  @IsInt() @Min(0) @Max(1000000000) outputTokens!: number;
}

