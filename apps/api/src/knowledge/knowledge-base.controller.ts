import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  CurrentUser,
  Roles,
  type AuthUser,
} from "../common/auth/auth.decorators";
import {
  Invalid,
  NotFound,
  Secured,
  UuidParam,
} from "../common/swagger/api-docs.decorators";
import { ErrorResponse } from "../common/swagger/schema-types";
import {
  KnowledgeDocumentUpdateDto,
  KnowledgeSettingsDto,
  KnowledgeUploadDto,
} from "./knowledge-base.dto";
import { KnowledgeBaseService } from "./knowledge-base.service";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const unavailable = ApiBadGatewayResponse({
  description: "The central knowledge service is unreachable.",
  type: ErrorResponse,
});
const notConfigured = ApiNotFoundResponse({
  description:
    "This deployment does not use the central knowledge base (not vendor-managed), or the document does not exist.",
  type: ErrorResponse,
});

/**
 * Vendor-managed deployments: documents and retrieval settings in the platform's central RAG
 * engine. The vendor's limits frame what an administrator can choose here.
 */
@ApiTags("knowledge")
@Secured()
@ApiForbiddenResponse({
  description:
    "Caller does not have the ADMIN role, the vendor turned the knowledge base off, or external providers are paused.",
  type: ErrorResponse,
})
@Roles("ADMIN")
@Controller("admin/knowledge")
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  @ApiOperation({
    summary: "Knowledge base limits, settings and usage",
    description:
      "The vendor's limits for this organization, the current retrieval settings and what applies after the limits (`effective`), the index being searched (`active`) and built (`target`), usage, and the embedding models the plan includes.",
  })
  @ApiOkResponse({ description: "Knowledge base overview." })
  @notConfigured
  @unavailable
  @Get("settings")
  overview() {
    return this.knowledgeBase.overview();
  }

  @ApiOperation({
    summary: "Change retrieval settings (audited)",
    description:
      "Top-K and the minimum score apply at once. Changing the embedding model or chunking builds a new index version from the stored text; search keeps the current one until it is complete. An external embedding model receives the text of every document.",
  })
  @ApiOkResponse({ description: "Whether a re-index started, and the new overview." })
  @Invalid()
  @ApiConflictResponse({
    description: "The settings would exceed the plan's chunk limits.",
    type: ErrorResponse,
  })
  @notConfigured
  @unavailable
  @Patch("settings")
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: KnowledgeSettingsDto,
  ) {
    return this.knowledgeBase.updateSettings(user, dto);
  }

  @ApiOperation({
    summary: "List documents in the knowledge base",
    description:
      "Status is INDEXING, READY or PAUSED (with a reason such as CREDIT_EXHAUSTED or POLICY).",
  })
  @ApiOkResponse({ description: "Documents, newest first." })
  @notConfigured
  @unavailable
  @Get("documents")
  documents() {
    return this.knowledgeBase.documents();
  }

  @ApiOperation({
    summary: "Upload a document (audited)",
    description:
      "CSV, TXT, MD or PDF, as the plan allows. Text is extracted in this deployment and stored in the central engine; indexing runs in the background through the same credit, quotas and policies as chat. A CSV with the product catalog columns keeps the catalog's passage format.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary", description: "At most 5 MB, or the plan's limit." },
        acknowledgeSensitive: { type: "string", enum: ["true", "false"] },
      },
    },
  })
  @ApiCreatedResponse({ description: "The stored document and its passage count." })
  @ApiBadRequestResponse({
    description:
      "Missing or unreadable file, a type the plan does not allow, a scanned PDF without text, or sensitive information that needs review (code SENSITIVE_CONTEXT).",
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: "A plan limit (documents, text, passages) would be exceeded.",
    type: ErrorResponse,
  })
  @ApiPayloadTooLargeResponse({ description: "The file or its text is too large.", type: ErrorResponse })
  @notConfigured
  @unavailable
  @Post("documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: KnowledgeUploadDto,
    @UploadedFile()
    file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.knowledgeBase.upload(
      user,
      file,
      dto.acknowledgeSensitive === "true",
    );
  }

  @ApiOperation({
    summary: "Turn a document on or off for chat (audited)",
  })
  @UuidParam("id", "Document ID.")
  @ApiOkResponse({ description: "The document's new state." })
  @Invalid({ id: true })
  @NotFound("Document")
  @unavailable
  @Patch("documents/:id")
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: KnowledgeDocumentUpdateDto,
  ) {
    return this.knowledgeBase.setEnabled(user, id, dto.enabled);
  }

  @ApiOperation({
    summary: "Delete a document and its passages (audited)",
  })
  @UuidParam("id", "Document ID.")
  @ApiOkResponse({ description: "Deleted." })
  @Invalid({ id: true })
  @NotFound("Document")
  @unavailable
  @Delete("documents/:id")
  remove(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeBase.remove(user, id);
  }

  @ApiOperation({
    summary: "Resume indexing a paused document (audited)",
  })
  @UuidParam("id", "Document ID.")
  @ApiOkResponse({ description: "Indexing resumed." })
  @Invalid({ id: true })
  @NotFound("Document")
  @unavailable
  @HttpCode(200)
  @Post("documents/:id/retry")
  retry(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeBase.retry(user, id);
  }
}
