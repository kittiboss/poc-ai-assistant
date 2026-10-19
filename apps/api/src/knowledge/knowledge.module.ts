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
import { KnowledgeService } from "./knowledge.service";

@Module({
  imports: [
    UsersModule,
    GatewayModule,
    UsageModule,
    WorkspaceModule,
    AuditModule,
  ],
  controllers: [KnowledgeController, KnowledgeAdminController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
