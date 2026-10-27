import { ApiProperty } from "@nestjs/swagger";
import { NULLABLE_STRING } from "../common/swagger/schema-types";

class EmbeddingModelRef {
  @ApiProperty({ example: "gemini-embedding" }) id!: string;
  @ApiProperty({ example: "Gemini Embedding 2" }) displayName!: string;
  @ApiProperty({ ...NULLABLE_STRING, example: "GEMINI" }) provider!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) local!: boolean | null;
}

export class KnowledgeStatusView {
  @ApiProperty({
    description:
      "The embedding model is enabled and configured, so the catalog can be indexed.",
  })
  ready!: boolean;
  @ApiProperty({
    description:
      "True when chat can use the product catalog (ready and indexed).",
  })
  available!: boolean;
  @ApiProperty({
    ...NULLABLE_STRING,
    example: "the product catalog has not been indexed yet",
  })
  problem!: string | null;
  @ApiProperty({
    type: () => EmbeddingModelRef,
    description: "Set by RAG_EMBEDDING_MODEL.",
  })
  embeddingModel!: EmbeddingModelRef;
  @ApiProperty({ example: 200 }) products!: number;
  @ApiProperty({
    example: 200,
    description: "Products whose current text is embedded with this model.",
  })
  indexed!: number;
  @ApiProperty({
    example: 0,
    description: "New or changed products awaiting indexing.",
  })
  stale!: number;
  @ApiProperty({
    example: 0,
    description: "Stored passages for products that no longer exist.",
  })
  orphaned!: number;
  @ApiProperty() indexing!: boolean;
  @ApiProperty({
    type: () => IndexRunView,
    nullable: true,
    description: "Current or most recent indexing run since the API started.",
  })
  lastRun!: IndexRunView | null;
  @ApiProperty({
    enum: ["catalog", "knowledge-base"],
    description:
      "catalog: this installation's product catalog. knowledge-base: the platform's central knowledge base (vendor-managed); products then counts documents and indexed/stale count passages.",
  })
  source!: "catalog" | "knowledge-base";
}

export class ImportResultView {
  @ApiProperty({ example: 200 }) rows!: number;
  @ApiProperty({ example: 0 }) created!: number;
  @ApiProperty({ example: 200 }) updated!: number;
  @ApiProperty({ type: () => KnowledgeStatusView })
  status!: KnowledgeStatusView;
}

export class IndexRunView {
  @ApiProperty({ example: "gemini-embedding" }) embeddingModel!: string;
  @ApiProperty({
    example: 200,
    description: "New or changed products this run embeds.",
  })
  pending!: number;
  @ApiProperty({ example: 100, description: "Products embedded so far." })
  embedded!: number;
  @ApiProperty({
    example: 0,
    description: "Passages removed for deleted products.",
  })
  removed!: number;
  @ApiProperty({
    example: 8,
    description:
      "Embedding requests (up to 100 products locally, 25 by default for external models).",
  })
  batches!: number;
  @ApiProperty({ format: "date-time" }) startedAt!: string;
  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Null while running.",
  })
  finishedAt!: string | null;
  @ApiProperty({
    ...NULLABLE_STRING,
    description: "Why the run stopped early; saved batches stay indexed.",
  })
  error!: string | null;
}

export class ReindexResultView extends IndexRunView {
  @ApiProperty({
    description: "False when nothing changed, so no provider was called.",
  })
  started!: boolean;
  @ApiProperty({
    example: 109,
    description:
      "Expected duration; external models are paced to the provider's per-minute quota.",
  })
  estimatedSeconds!: number;
}
