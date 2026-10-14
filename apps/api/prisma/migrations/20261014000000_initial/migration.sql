CREATE TYPE "Provider" AS ENUM ('MOCK', 'OLLAMA', 'OPENAI', 'ANTHROPIC', 'GEMINI');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'INTERRUPTED', 'ERROR');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'CANCELLED', 'ERROR');
CREATE TYPE "UsageKind" AS ENUM ('ACTUAL', 'ESTIMATED', 'SYNTHETIC');
CREATE TYPE "PricingStrategy" AS ENUM ('PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION');

CREATE TABLE "User" (
  "id" UUID NOT NULL, "externalId" TEXT NOT NULL, "username" TEXT NOT NULL, "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Role" ("id" UUID NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "Role_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Permission" ("id" UUID NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "Permission_pkey" PRIMARY KEY ("id"));
CREATE TABLE "UserRole" ("userId" UUID NOT NULL, "roleId" UUID NOT NULL, CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId"));
CREATE TABLE "RolePermission" ("roleId" UUID NOT NULL, "permissionId" UUID NOT NULL, CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId"));
CREATE TABLE "AIModel" (
  "id" TEXT NOT NULL, "displayName" TEXT NOT NULL, "provider" "Provider" NOT NULL,
  "providerModelId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "allowedRoles" TEXT[],
  "contextWindow" INTEGER NOT NULL, "capabilities" TEXT[], "local" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UserModelPermission" (
  "userId" UUID NOT NULL, "modelId" TEXT NOT NULL, "allowed" BOOLEAN NOT NULL,
  CONSTRAINT "UserModelPermission_pkey" PRIMARY KEY ("userId", "modelId")
);
CREATE TABLE "Conversation" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "title" TEXT NOT NULL DEFAULT 'New conversation',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Message" (
  "id" UUID NOT NULL, "conversationId" UUID NOT NULL, "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL, "status" "MessageStatus" NOT NULL DEFAULT 'COMPLETED', "modelId" TEXT,
  "requestId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UsageRecord" (
  "id" UUID NOT NULL, "requestId" TEXT NOT NULL, "userId" UUID NOT NULL, "conversationId" UUID NOT NULL,
  "modelId" TEXT NOT NULL, "pricingVersionId" UUID, "provider" "Provider" NOT NULL,
  "inputTokens" INTEGER NOT NULL, "outputTokens" INTEGER NOT NULL, "totalTokens" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL, "status" "RequestStatus" NOT NULL, "usageKind" "UsageKind" NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD', "actualProviderCost" DECIMAL(24,12) NOT NULL,
  "customerCharge" DECIMAL(24,12) NOT NULL, "simulatedProviderCost" DECIMAL(24,12) NOT NULL,
  "simulatedCustomerCharge" DECIMAL(24,12) NOT NULL, "pricingSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PricingConfiguration" (
  "id" UUID NOT NULL, "modelId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PricingVersion" (
  "id" UUID NOT NULL, "configurationId" UUID NOT NULL, "version" INTEGER NOT NULL,
  "strategy" "PricingStrategy" NOT NULL, "providerInputRate" DECIMAL(24,12) NOT NULL,
  "providerOutputRate" DECIMAL(24,12) NOT NULL, "cachedInputRate" DECIMAL(24,12),
  "additionalFee" DECIMAL(24,12) NOT NULL DEFAULT 0, "customerInputRate" DECIMAL(24,12) NOT NULL DEFAULT 0,
  "customerOutputRate" DECIMAL(24,12) NOT NULL DEFAULT 0, "markupPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "simulationInputRate" DECIMAL(24,12) NOT NULL DEFAULT 0, "simulationOutputRate" DECIMAL(24,12) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD', "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL, "actorId" UUID, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "before" JSONB, "after" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ApplicationSetting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");
CREATE INDEX "AIModel_provider_enabled_idx" ON "AIModel"("provider", "enabled");
CREATE INDEX "Conversation_userId_deletedAt_updatedAt_idx" ON "Conversation"("userId", "deletedAt", "updatedAt");
CREATE UNIQUE INDEX "Message_requestId_key" ON "Message"("requestId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE UNIQUE INDEX "UsageRecord_requestId_key" ON "UsageRecord"("requestId");
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");
CREATE INDEX "UsageRecord_modelId_createdAt_idx" ON "UsageRecord"("modelId", "createdAt");
CREATE UNIQUE INDEX "PricingConfiguration_modelId_key" ON "PricingConfiguration"("modelId");
CREATE INDEX "PricingVersion_configurationId_effectiveAt_idx" ON "PricingVersion"("configurationId", "effectiveAt");
CREATE UNIQUE INDEX "PricingVersion_configurationId_version_key" ON "PricingVersion"("configurationId", "version");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModelPermission" ADD CONSTRAINT "UserModelPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModelPermission" ADD CONSTRAINT "UserModelPermission_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PricingConfiguration" ADD CONSTRAINT "PricingConfiguration_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingVersion" ADD CONSTRAINT "PricingVersion_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "PricingConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
