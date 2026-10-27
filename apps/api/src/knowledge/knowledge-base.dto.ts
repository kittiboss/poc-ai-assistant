import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/** Bounds here are the platform's; the RAG engine also applies this tenant's vendor limits. */
export class KnowledgeSettingsDto {
  @ApiPropertyOptional({
    example: "mock-embedding",
    description:
      "One of the embedding models in your plan. Changing it re-indexes every document (an external model receives their text).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  embeddingModel?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, description: "Passages per question, up to the plan's maximum." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 0.9, description: "Passages scoring lower are not used." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.9)
  minScore?: number;

  @ApiPropertyOptional({ minimum: 400, maximum: 2000, description: "Characters per passage. Changing it re-indexes." })
  @IsOptional()
  @IsInt()
  @Min(400)
  @Max(2000)
  chunkSize?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 800, description: "Characters shared by consecutive passages (at most 40% of the chunk size). Changing it re-indexes." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(800)
  chunkOverlap?: number;

  @ApiPropertyOptional({ description: "Acknowledge that documents with sensitive information go to an external embedding model." })
  @IsOptional()
  @IsBoolean()
  acknowledgeSensitive?: boolean;
}

export class KnowledgeDocumentUpdateDto {
  @ApiProperty({ description: "Whether chat may use this document." })
  @IsBoolean()
  enabled!: boolean;
}

/** Multipart form fields arrive as text. */
export class KnowledgeUploadDto {
  @ApiPropertyOptional({ enum: ["true", "false"], description: "Acknowledge sensitive-information findings for an external embedding model." })
  @IsOptional()
  @IsIn(["true", "false"])
  acknowledgeSensitive?: string;
}
