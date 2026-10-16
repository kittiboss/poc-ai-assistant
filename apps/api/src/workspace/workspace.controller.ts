import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import {
  CurrentUser,
  Roles,
  type AuthUser,
} from "../common/auth/auth.decorators";
import {
  Invalid,
  MalformedId,
  Secured,
  UuidParam,
} from "../common/swagger/api-docs.decorators";
import {
  DepartmentDto,
  GovernanceDto,
  InstructionsDto,
  MemoryDto,
  ProjectDto,
  QuotaDto,
  TemplateDto,
  ToolDto,
} from "./workspace.dto";
import { GovernanceService } from "./governance.service";
import { WorkspaceService } from "./workspace.service";

@ApiTags("workspace")
@Secured()
@Controller("workspace")
export class WorkspaceController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly governance: GovernanceService,
  ) {}
  @Get("projects")
  @ApiOperation({ summary: "List private projects and sources" })
  @ApiOkResponse()
  projects(@CurrentUser() auth: AuthUser) {
    return this.service.projects(auth);
  }
  @Post("projects")
  @ApiOperation({ summary: "Create a private project" })
  @ApiOkResponse()
  create(@CurrentUser() auth: AuthUser, @Body() dto: ProjectDto) {
    return this.service.saveProject(auth, dto);
  }
  @Patch("projects/:id")
  @ApiOperation({ summary: "Update project instructions" })
  @UuidParam("id", "Project ID")
  @Invalid({ id: true })
  @ApiOkResponse()
  project(
    @CurrentUser() auth: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ProjectDto,
  ) {
    return this.service.saveProject(auth, dto, id);
  }
  @Delete("projects/:id")
  @ApiOperation({ summary: "Delete project and sources; keep chats ungrouped" })
  @UuidParam("id", "Project ID")
  @MalformedId()
  @ApiOkResponse()
  deleteProject(@CurrentUser() auth: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteProject(auth, id);
  }
  @Post("projects/:id/sources")
  @ApiOperation({
    summary: "Extract and index a document locally (5 MB, 100 PDF pages)",
  })
  @UuidParam("id", "Project ID")
  @MalformedId()
  @ApiOkResponse()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentUser() auth: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: { originalname: string; buffer: Buffer },
  ) {
    return this.service.upload(auth, id, file);
  }
  @Get("sources/:id")
  @ApiOperation({
    summary: "View extracted source text belonging to the caller",
  })
  @UuidParam("id", "Source ID")
  @MalformedId()
  @ApiOkResponse()
  source(@CurrentUser() auth: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.source(auth, id);
  }
  @Delete("sources/:id")
  @ApiOperation({ summary: "Remove source from future retrieval" })
  @UuidParam("id", "Source ID")
  @MalformedId()
  @ApiOkResponse()
  removeSource(@CurrentUser() auth: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteSource(auth, id);
  }
  @Get("preferences")
  @ApiOperation({ summary: "Get custom instructions and explicit memories" })
  @ApiOkResponse()
  preferences(@CurrentUser() auth: AuthUser) {
    return this.service.preferences(auth);
  }
  @Patch("preferences")
  @ApiOperation({ summary: "Save personal instructions" })
  @ApiOkResponse()
  instructions(@CurrentUser() auth: AuthUser, @Body() dto: InstructionsDto) {
    return this.service.instructions(auth, dto.instructions);
  }
  @Post("memories")
  @ApiOperation({ summary: "Create explicit user-approved memory" })
  @ApiOkResponse()
  addMemory(@CurrentUser() auth: AuthUser, @Body() dto: MemoryDto) {
    return this.service.memory(auth, dto);
  }
  @Patch("memories/:id")
  @ApiOperation({ summary: "Edit or disable memory" })
  @UuidParam("id", "Memory ID")
  @Invalid({ id: true })
  @ApiOkResponse()
  memory(
    @CurrentUser() auth: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MemoryDto,
  ) {
    return this.service.memory(auth, dto, id);
  }
  @Delete("memories/:id")
  @ApiOperation({ summary: "Delete memory" })
  @UuidParam("id", "Memory ID")
  @MalformedId()
  @ApiOkResponse()
  deleteMemory(@CurrentUser() auth: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteMemory(auth, id);
  }
  @Get("templates")
  @ApiOperation({ summary: "List permitted prompt templates" })
  @ApiOkResponse()
  templates(@CurrentUser() auth: AuthUser) {
    return this.service.templates(auth);
  }
  @Post("tools")
  @ApiOperation({
    summary: "Run an explicitly selected allowlisted local tool; no model call",
  })
  @ApiOkResponse()
  tool(@CurrentUser() auth: AuthUser, @Body() dto: ToolDto) {
    return this.service.tool(auth, dto);
  }
  @Get("usage.csv")
  @ApiOperation({ summary: "Export own latest 10,000 usage records as CSV" })
  @ApiOkResponse()
  export(@CurrentUser() auth: AuthUser) {
    return this.governance.usageCsv(auth);
  }
}

@ApiTags("governance")
@Secured()
@Roles("ADMIN")
@Controller("admin/workspace")
export class WorkspaceAdminController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly governance: GovernanceService,
  ) {}
  @Get()
  @ApiOperation({
    summary: "Get quotas, departments and feedback analytics; no chat content",
  })
  @ApiOkResponse()
  dashboard() {
    return this.governance.dashboard();
  }
  @Patch("settings")
  @ApiOperation({
    summary:
      "Set external kill switch, sensitive-data policy and chat retention",
  })
  @ApiOkResponse()
  settings(@CurrentUser() auth: AuthUser, @Body() dto: GovernanceDto) {
    return this.governance.saveSettings(auth, dto);
  }
  @Post("quotas")
  @ApiOperation({ summary: "Set quota for a user, role, model or department" })
  @ApiOkResponse()
  quota(@CurrentUser() auth: AuthUser, @Body() dto: QuotaDto) {
    return this.governance.saveQuota(auth, dto);
  }
  @Delete("quotas/:id")
  @ApiOperation({ summary: "Remove quota policy" })
  @UuidParam("id", "Quota policy ID")
  @MalformedId()
  @ApiOkResponse()
  deleteQuota(@CurrentUser() auth: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.governance.deleteQuota(auth, id);
  }
  @Patch("users/:id")
  @ApiOperation({ summary: "Assign department for usage budgets" })
  @UuidParam("id", "User ID")
  @Invalid({ id: true })
  @ApiOkResponse()
  department(
    @CurrentUser() auth: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DepartmentDto,
  ) {
    return this.governance.department(auth, id, dto.department);
  }
  @Get("templates")
  @ApiOperation({ summary: "Manage all prompt templates" })
  @ApiOkResponse()
  templates(@CurrentUser() auth: AuthUser) {
    return this.service.templates(auth, true);
  }
  @Post("templates")
  @ApiOperation({ summary: "Create an audited prompt template" })
  @ApiOkResponse()
  template(@CurrentUser() auth: AuthUser, @Body() dto: TemplateDto) {
    return this.service.saveTemplate(auth, dto);
  }
  @Patch("templates/:id")
  @ApiOperation({ summary: "Edit or disable an audited template" })
  @UuidParam("id", "Template ID")
  @Invalid({ id: true })
  @ApiOkResponse()
  editTemplate(
    @CurrentUser() auth: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TemplateDto,
  ) {
    return this.service.saveTemplate(auth, dto, id);
  }
  @Get("usage.csv")
  @ApiOperation({ summary: "Export latest 10,000 installation usage records" })
  @ApiOkResponse()
  export(@CurrentUser() auth: AuthUser) {
    return this.governance.usageCsv(auth, true);
  }
  @Get("retention")
  @ApiOperation({ summary: "Preview chat-content retention counts" })
  @ApiOkResponse()
  retention() {
    return this.governance.retentionPreview();
  }
}
