import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { GatewayModule } from "../gateway/gateway.module";
import { UsageModule } from "../usage/usage.module";
import { UsersModule } from "../users/users.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import {
  KnowledgeAdminController,
  KnowledgeController,
} from "./knowledge.controller";
import { KnowledgeBaseController } from "./knowledge-base.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeService } from "./knowledge.service";
import { RagEngineClient } from "./rag-engine.client";

@Module({
  imports: [
    UsersModule,
    GatewayModule,
    UsageModule,
    WorkspaceModule,
    AuditModule,
  ],
  controllers: [
    KnowledgeController,
    KnowledgeAdminController,
    KnowledgeBaseController,
  ],
  providers: [KnowledgeService, KnowledgeBaseService, RagEngineClient],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
