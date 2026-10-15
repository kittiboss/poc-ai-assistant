import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ProjectDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty() @IsString() @MaxLength(6000) instructions!: string;
}
export class InstructionsDto {
  @ApiProperty() @IsString() @MaxLength(6000) instructions!: string;
}
export class MemoryDto {
  @ApiProperty() @IsString() @Length(1, 500) content!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class TemplateDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty() @IsString() @MaxLength(500) description!: string;
  @ApiProperty() @IsString() @Length(1, 6000) systemPrompt!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  allowedModels!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(["USER", "ADMIN"], { each: true })
  allowedRoles!: string[];
  @ApiProperty() @IsNumber() @Min(0) @Max(2) temperature!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(4096) maxOutputTokens!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class ToolDto {
  @ApiProperty({
    enum: [
      "calculator",
      "time",
      "search",
      "faq",
      "usage",
      "prices",
      "csv",
      "markdown",
    ],
  })
  @IsIn([
    "calculator",
    "time",
    "search",
    "faq",
    "usage",
    "prices",
    "csv",
    "markdown",
  ])
  tool!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  input?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
}
export class FeedbackDto {
  @ApiProperty({ enum: [-1, 1] }) @IsIn([-1, 1]) rating!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
export class BranchDto {
  @ApiProperty() @IsUUID() messageId!: string;
  @ApiPropertyOptional({
    description:
      "Exclude the selected message, for edit/resend or regeneration.",
  })
  @IsOptional()
  @IsBoolean()
  before?: boolean;
}
export class QuotaDto {
  @ApiProperty({ enum: ["USER", "ROLE", "MODEL", "DEPARTMENT"] })
  @IsIn(["USER", "ROLE", "MODEL", "DEPARTMENT"])
  scope!: string;
  @ApiProperty() @IsString() @Length(1, 120) subject!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  dailyRequests?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  dailyTokens?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  perRequestTokens?: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description: "Daily simulated provider cost limit in USD.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000)
  dailySimulatedBudget?: number | null;
}
export class GovernanceDto {
  @ApiProperty() @IsBoolean() externalBlocked!: boolean;
  @ApiProperty({
    description:
      "0 disables automatic chat-content retention. Usage records remain.",
  })
  @IsInt()
  @Min(0)
  @Max(3650)
  retentionDays!: number;
  @ApiProperty() @IsIn(["WARN", "BLOCK"]) sensitiveMode!: "WARN" | "BLOCK";
}
export class DepartmentDto {
  @ApiProperty() @IsString() @MaxLength(120) department!: string;
}
