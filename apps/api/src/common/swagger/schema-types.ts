import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Shared OpenAPI property shapes. Decimal columns serialize as strings.
export const DECIMAL = { type: String, format: 'decimal', example: '0.000000000000' } as const;
export const NULLABLE_DECIMAL = { ...DECIMAL, nullable: true } as const;
export const DATE = { type: String, format: 'date-time' } as const;

export class ErrorResponse {
  @ApiProperty({ example: 404 }) statusCode!: number;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], example: 'Conversation not found' }) message!: string | string[];
  @ApiPropertyOptional({ example: 'Not Found' }) error?: string;
}
