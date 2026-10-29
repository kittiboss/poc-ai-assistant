import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Shared OpenAPI property shapes. Decimal columns serialize as strings.
export const DECIMAL = { type: String, format: 'decimal', example: '0.000000000000' } as const;
export const NULLABLE_DECIMAL = { ...DECIMAL, nullable: true } as const;
export const DATE = { type: String, format: 'date-time' } as const;
// Nullable properties need an explicit type: `number | null` is reflected as Object and documented as an empty object.
export const NULLABLE_INT = { type: 'integer', nullable: true } as const;
export const NULLABLE_NUMBER = { type: Number, nullable: true } as const;
export const NULLABLE_STRING = { type: String, nullable: true } as const;
export const NULLABLE_UUID = { type: String, format: 'uuid', nullable: true } as const;

export class ErrorResponse {
  @ApiProperty({ example: 404 }) statusCode!: number;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], example: 'Conversation not found' }) message!: string | string[];
  @ApiPropertyOptional({ example: 'Not Found' }) error?: string;
  @ApiPropertyOptional({ example: 'ATTACHMENT_TYPE', description: 'Stable reason a client can word itself, on errors that have one.' }) code?: string;
}
