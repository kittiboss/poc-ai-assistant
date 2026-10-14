import { ApiProperty } from '@nestjs/swagger';
import { DATE } from '../common/swagger/schema-types';

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
