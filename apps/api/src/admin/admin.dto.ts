import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class TestCreditDto {
  @ApiProperty({ example: '2.00', description: 'Simulated USD only; no payment is collected.' })
  @IsString() @Matches(/^\d{1,5}(\.\d{1,9})?$/) amount!: string;
  @ApiProperty({ description: 'Unique idempotency key, reused when retrying the same top-up.' })
  @IsString() @Matches(/^[a-zA-Z0-9:_-]{1,100}$/) reference!: string;
}
import { PROVIDERS } from '../models/models.dto';

export class UpdatePermissionDto {
  @ApiProperty({ example: true })
  @IsBoolean() allowed!: boolean;
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
