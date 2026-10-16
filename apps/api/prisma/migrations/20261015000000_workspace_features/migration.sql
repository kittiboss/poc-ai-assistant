ALTER TABLE "User" ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '', ADD COLUMN "department" TEXT NOT NULL DEFAULT '';
CREATE TABLE "Project" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "name" VARCHAR(120) NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
ALTER TABLE "Conversation" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "projectId" UUID;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD COLUMN "citations" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "feedback" INTEGER,
  ADD COLUMN "feedbackComment" VARCHAR(1000), ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Message" ADD CONSTRAINT "Message_feedback_check" CHECK ("feedback" IN (-1, 1));
CREATE TABLE "Source" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "filename" VARCHAR(200) NOT NULL, "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Source_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Source_projectId_idx" ON "Source"("projectId");
CREATE TABLE "SourceChunk" (
  "id" UUID NOT NULL, "sourceId" UUID NOT NULL, "ordinal" INTEGER NOT NULL, "page" INTEGER, "content" TEXT NOT NULL,
  CONSTRAINT "SourceChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceChunk_sourceId_ordinal_key" ON "SourceChunk"("sourceId", "ordinal");
CREATE INDEX "SourceChunk_search_idx" ON "SourceChunk" USING GIN (to_tsvector('simple', "content"));
CREATE INDEX "Message_search_idx" ON "Message" USING GIN (to_tsvector('simple', "content"));
CREATE TABLE "Memory" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "content" VARCHAR(500) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Memory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Memory_userId_idx" ON "Memory"("userId");
CREATE TABLE "PromptTemplate" (
  "id" UUID NOT NULL, "name" VARCHAR(120) NOT NULL, "description" VARCHAR(500) NOT NULL DEFAULT '', "systemPrompt" TEXT NOT NULL,
  "allowedModels" TEXT[] NOT NULL, "allowedRoles" TEXT[] NOT NULL, "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "maxOutputTokens" INTEGER NOT NULL DEFAULT 1024, "enabled" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QuotaPolicy" (
  "id" UUID NOT NULL, "scope" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "dailyRequests" INTEGER, "dailyTokens" INTEGER, "perRequestTokens" INTEGER, "dailySimulatedBudget" DECIMAL(24,12),
  CONSTRAINT "QuotaPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuotaPolicy_scope_subject_key" ON "QuotaPolicy"("scope", "subject");
CREATE TABLE "UsageReservation" (
  "id" TEXT NOT NULL, "userId" UUID NOT NULL, "modelId" TEXT NOT NULL, "department" TEXT NOT NULL, "roles" TEXT[] NOT NULL,
  "external" BOOLEAN NOT NULL, "tokens" INTEGER NOT NULL, "simulatedCost" DECIMAL(24,12) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UsageReservation_expiresAt_idx" ON "UsageReservation"("expiresAt");
