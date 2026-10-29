import { ApiProperty } from "@nestjs/swagger";
import { DATE, NULLABLE_INT } from "../common/swagger/schema-types";

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
    description: "Characters of extracted text that the model reads.",
  })
  charCount!: number;
}

export class AttachmentView extends AttachmentRefView {
  @ApiProperty(DATE) createdAt!: string;
}
