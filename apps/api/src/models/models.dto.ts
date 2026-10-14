import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';

export const PROVIDERS = ['MOCK', 'OLLAMA', 'OPENAI', 'ANTHROPIC', 'GEMINI'] as const;

export class UpdateModelDto {
  @ApiPropertyOptional({ example: true, description: 'External models can be enabled only when ENABLE_EXTERNAL_PROVIDERS=true and the provider credential is configured.' })
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['ADMIN', 'USER'], isArray: true, example: ['ADMIN', 'USER'], description: 'Roles allowed by default; explicit per-user permissions override this.' })
  @IsOptional() @IsArray() @IsIn(['ADMIN', 'USER'], { each: true }) allowedRoles?: string[];
}
