import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';
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
