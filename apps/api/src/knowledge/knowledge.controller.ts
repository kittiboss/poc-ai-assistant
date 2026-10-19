import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import {
  CurrentUser,
  Roles,
  type AuthUser,
} from "../common/auth/auth.decorators";
import { Secured } from "../common/swagger/api-docs.decorators";
import { ErrorResponse } from "../common/swagger/schema-types";
import {
  ImportResultView,
  KnowledgeStatusView,
  ReindexResultView,
} from "./knowledge.schemas";
import { KnowledgeService } from "./knowledge.service";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

@ApiTags("knowledge")
@Secured()
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @ApiOperation({
    summary: "Product catalog status for chat",
    description:
      "Whether chat can use the product catalog, and with which embedding model. Never calls a provider.",
  })
  @ApiOkResponse({ type: KnowledgeStatusView })
  @Get("status")
  status() {
    return this.knowledge.status();
  }
}

@ApiTags("knowledge")
@Secured()
@ApiForbiddenResponse({
  description: "Caller does not have the ADMIN role.",
  type: ErrorResponse,
})
@Roles("ADMIN")
@Controller("admin/knowledge")
export class KnowledgeAdminController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @ApiOperation({
    summary: "Import the product catalog from CSV (audited)",
    description:
      "Upserts rows by product_id using the columns of prisma/data/schema.sql. The whole file is rejected if any row is invalid. Does not embed anything; run reindex afterwards.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "products.csv, at most 2 MB",
        },
      },
    },
  })
  @ApiCreatedResponse({ type: ImportResultView })
  @ApiBadRequestResponse({
    description:
      "Missing file, invalid CSV (row-level errors are listed), or a SKU owned by another product_id.",
    type: ErrorResponse,
  })
  @Post("products/import")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_CSV_BYTES, files: 1 } }),
  )
  importProducts(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { buffer: Buffer; size: number },
  ) {
    if (!file?.size)
      throw new BadRequestException("Attach a CSV file in the 'file' field");
    return this.knowledge.importProducts(user, file.buffer.toString("utf8"));
  }

  @ApiOperation({
    summary: "Start embedding new or changed products (audited)",
    description:
      "Uses RAG_EMBEDDING_MODEL and returns immediately; poll GET /knowledge/status (lastRun) for progress. Unchanged products are skipped. With an external model the provider is called in small paced batches (default 25 texts every 15.5 s, because Gemini's free tier counts each text against a 100-per-minute quota), through the same quotas and daily limits as chat.",
  })
  @ApiOkResponse({ type: ReindexResultView })
  @ApiBadRequestResponse({
    description:
      "The embedding model is disabled, unconfigured, or not an embedding model.",
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: "Indexing is already running.",
    type: ErrorResponse,
  })
  @HttpCode(200)
  @Post("reindex")
  reindex(@CurrentUser() user: AuthUser) {
    return this.knowledge.reindex(user);
  }
}
