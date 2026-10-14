import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class AuditQueryDto {
  @ApiPropertyOptional({ enum: ['AIModel', 'UserModelPermission', 'PricingConfiguration'] })
  @IsOptional() @IsIn(['AIModel', 'UserModelPermission', 'PricingConfiguration']) entityType?: string;
}
