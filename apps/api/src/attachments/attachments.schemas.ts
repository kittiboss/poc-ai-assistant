import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AttachmentKind } from "@prisma/client";
import { DATE, NULLABLE_INT } from "../common/swagger/schema-types";
import { IMAGE_TYPES } from "./images";

/** A file as a user message lists it in metadata.attachments. */
export class AttachmentRefView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "leave-policy.pdf" }) filename!: string;
  @ApiProperty({
    type: "integer",
    example: 182044,
    description: "Size of the uploaded file in bytes.",
  })
  byteSize!: number;
  @ApiProperty({
    ...NULLABLE_INT,
    example: 12,
    description: "PDF pages; null for other types.",
  })
  pageCount!: number | null;
  @ApiProperty({
    type: "integer",
    example: 18350,
    description:
      "Characters of extracted text that the model reads; 0 for images.",
  })
  charCount!: number;
  @ApiPropertyOptional({
    enum: AttachmentKind,
    description:
      "Absent on files sent before images were supported: a document.",
  })
  kind?: AttachmentKind;
  @ApiPropertyOptional({
    enum: IMAGE_TYPES,
    description: "Images only, read from the file's first bytes.",
  })
  mimeType?: string;
  @ApiPropertyOptional({
    type: "integer",
    example: 1600,
    description: "Images only, in pixels.",
  })
  width?: number;
  @ApiPropertyOptional({
    type: "integer",
    example: 900,
    description: "Images only, in pixels.",
  })
  height?: number;
}

export class AttachmentView extends AttachmentRefView {
  @ApiProperty(DATE) createdAt!: string;
}
