-- pgvector powers semantic retrieval over company knowledge (the product catalog first).
CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding calls are metered like chat calls. Catalog indexing has no conversation.
CREATE TYPE "UsageOperation" AS ENUM ('CHAT', 'EMBEDDING');
ALTER TABLE "UsageRecord" ADD COLUMN "operation" "UsageOperation" NOT NULL DEFAULT 'CHAT';
ALTER TABLE "UsageRecord" ALTER COLUMN "conversationId" DROP NOT NULL;

-- Product catalog, exactly as defined by the supplied prisma/data/schema.sql.
CREATE TABLE products (
    product_id      INT            PRIMARY KEY,
    sku             VARCHAR(20)    NOT NULL UNIQUE,
    name            VARCHAR(150)   NOT NULL,
    description     TEXT           NOT NULL,
    category        VARCHAR(50)    NOT NULL,
    subcategory     VARCHAR(50)    NOT NULL,
    brand           VARCHAR(50)    NOT NULL,
    price           DECIMAL(10,2)  NOT NULL,
    cost_price      DECIMAL(10,2)  NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'USD',
    stock_quantity  INT            NOT NULL DEFAULT 0,
    weight_kg       DECIMAL(8,2),
    color           VARCHAR(50),
    material        VARCHAR(100),
    rating          DECIMAL(2,1),
    review_count    INT            NOT NULL DEFAULT 0,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP      NOT NULL,
    updated_at      TIMESTAMP      NOT NULL
);

-- One embedded passage per knowledge item and embedding model. Vectors from different
-- models are not comparable, so retrieval always filters on "embeddingModel".
CREATE TABLE "KnowledgeChunk" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embeddingModel" TEXT NOT NULL,
  "embedding" vector(768) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KnowledgeChunk_source_sourceId_embeddingModel_key" ON "KnowledgeChunk"("source", "sourceId", "embeddingModel");
CREATE INDEX "KnowledgeChunk_embedding_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
