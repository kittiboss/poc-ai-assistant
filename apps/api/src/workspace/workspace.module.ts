import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuditModule } from "../audit/audit.module";
import { WorkspaceService } from "./workspace.service";
import { GovernanceService } from "./governance.service";
import {
  WorkspaceAdminController,
  WorkspaceController,
} from "./workspace.controller";

@Module({
  imports: [UsersModule, AuditModule],
  controllers: [WorkspaceController, WorkspaceAdminController],
  providers: [WorkspaceService, GovernanceService],
  exports: [WorkspaceService, GovernanceService],
})
export class WorkspaceModule {}
