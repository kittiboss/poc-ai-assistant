import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, type AuthUser } from "../common/auth/auth.decorators";
import { FileUpload } from "../common/file-upload";
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
import { IMAGE_TYPES } from "./images";

const StorageUnavailable = () =>
  ApiServiceUnavailableResponse({
    description: "Image storage is unavailable; retry shortly.",
    type: ErrorResponse,
  });

/** Documents and images attached to the caller's next chat message; see docs/CHAT_ATTACHMENTS.md. */
@ApiTags("attachments")
@Secured()
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @ApiOperation({
    summary: "Attach a document or image to the caller's next chat message",
    description:
      "TXT, MD, CSV, JSON, text PDF or DOCX: text is extracted in this deployment and only the text is kept. JPEG, PNG or WebP, where models report the `vision` capability: the file is kept in object storage. The type of an image is read from its first bytes. The attachment stays unsent until a message lists it in `attachmentIds`; unsent attachments are removed after 24 hours.",
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
          description:
            "At most 5 MB; an image at most 1 MB and 1,600 px on its longer side.",
        },
      },
    },
  })
  @ApiCreatedResponse({ type: AttachmentView })
  @ApiBadRequestResponse({
    description:
      "No file (no code), or code ATTACHMENT_TYPE (unsupported type, or an image where images are unavailable), ATTACHMENT_SIZE (empty, or an image over 1 MB or 1,600 px), ATTACHMENT_UNREADABLE, ATTACHMENT_NO_TEXT (such as a scanned PDF) or ATTACHMENT_TOO_LONG (more than 60,000 characters of text).",
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
  @StorageUnavailable()
  @Post()
  @UseInterceptors(
    FileUpload({ fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0 }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { originalname: string; buffer: Buffer },
  ) {
    return this.attachments.upload(user, file);
  }

  @ApiOperation({
    summary: "Download an attached image",
    description:
      "For the image's owner only. Documents keep no file. The file never changes, so the browser may cache it.",
  })
  @UuidParam("id", "Image attachment ID owned by the caller.")
  @ApiProduces(...IMAGE_TYPES)
  @ApiOkResponse({
    description: "The image file, with the type read at upload.",
    schema: { type: "string", format: "binary" },
  })
  @MalformedId()
  @NotFound("Image attachment")
  @StorageUnavailable()
  @Get(":id/content")
  async content(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.attachments.content(user, id);
    // Set here rather than with @Header, which also applies to errors: a cached 503 would hide
    // the image for a year.
    res.set({
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(image.body, {
      type: image.contentType,
      length: image.byteSize,
    });
  }

  @ApiOperation({ summary: "Remove an attachment that was not sent" })
  @UuidParam("id", "Attachment ID owned by the caller.")
  @ApiNoContentResponse({ description: "Removed, with its image file." })
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
