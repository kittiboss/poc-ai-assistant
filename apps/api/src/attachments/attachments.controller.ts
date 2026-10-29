import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
  ApiNoContentResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "../common/auth/auth.decorators";
import {
  MalformedId,
  NotFound,
  Secured,
  UuidParam,
} from "../common/swagger/api-docs.decorators";
import { ErrorResponse } from "../common/swagger/schema-types";
import { AttachmentView } from "./attachments.schemas";
import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
} from "./attachments.service";

/** Documents attached to the caller's next chat message; see docs/CHAT_ATTACHMENTS.md. */
@ApiTags("attachments")
@Secured()
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @ApiOperation({
    summary: "Attach a document to the caller's next chat message",
    description:
      "TXT, MD, CSV, JSON, text PDF or DOCX. Text is extracted in this deployment and only the text is kept. The attachment stays unsent until a message lists it in `attachmentIds`; unsent attachments are removed after 24 hours.",
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
          description: "At most 5 MB.",
        },
      },
    },
  })
  @ApiCreatedResponse({ type: AttachmentView })
  @ApiBadRequestResponse({
    description:
      "No file (no code), or code ATTACHMENT_TYPE (unsupported type), ATTACHMENT_SIZE (empty), ATTACHMENT_UNREADABLE, ATTACHMENT_NO_TEXT (such as a scanned PDF) or ATTACHMENT_TOO_LONG (more than 60,000 characters of text).",
    type: ErrorResponse,
  })
  @ApiPayloadTooLargeResponse({
    description: "The file is over 5 MB.",
    type: ErrorResponse,
  })
  @ApiTooManyRequestsResponse({
    description:
      "Another document is being extracted (code ATTACHMENT_BUSY); retry shortly. Also the rate limit of 60 requests per minute.",
    type: ErrorResponse,
  })
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0 },
      // Browsers send the filename as UTF-8; the Latin-1 default garbles Thai names.
      defParamCharset: "utf8",
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { originalname: string; buffer: Buffer },
  ) {
    return this.attachments.upload(user, file);
  }

  @ApiOperation({ summary: "Remove an attachment that was not sent" })
  @UuidParam("id", "Attachment ID owned by the caller.")
  @ApiNoContentResponse({ description: "Removed." })
  @MalformedId()
  @NotFound("Attachment")
  @ApiConflictResponse({
    description:
      "The attachment was sent and stays with its chat (code ATTACHMENT_SENT).",
    type: ErrorResponse,
  })
  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attachments.remove(user, id);
  }
}
