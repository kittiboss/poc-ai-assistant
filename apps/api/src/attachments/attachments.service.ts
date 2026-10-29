import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import { UsersService } from "../users/users.service";
import {
  NO_READABLE_TEXT,
  documentProblem,
  extractDocument,
  safeFilename,
  type Page,
} from "../workspace/documents";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/**
 * All files of a chat share this much text, so one file can use at most all of it. vendor-control
 * takes at most 250,000 bytes of input, and Thai uses 3 bytes per character; the rest is for history.
 */
export const MAX_CHAT_ATTACHMENT_CHARS = 60_000;
/** Attached but never sent (a closed tab, a failed removal): removed after this long. */
export const UNSENT_ATTACHMENT_TTL_MS = 24 * 60 * 60_000;

/** `code` lets the web word the error itself; the message is for other API clients. */
export const attachmentError = (
  status: number,
  code: string,
  message: string,
) => new HttpException({ statusCode: status, code, message }, status);

/** The text the model reads, with page markers for PDFs so a reply can point at a page. */
export function attachmentText(pages: Page[]) {
  return pages
    .map(({ text, page }) => {
      const body = text.replace(/\0/g, "").trim();
      return page !== null && body ? `[Page ${page}]\n${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

const attachmentView = {
  id: true,
  filename: true,
  byteSize: true,
  pageCount: true,
  charCount: true,
  createdAt: true,
} as const;

@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  onModuleInit() {
    void this.removeUnsent();
    this.sweepTimer = setInterval(() => void this.removeUnsent(), 60 * 60_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer);
  }

  async upload(
    auth: AuthUser,
    file?: { originalname: string; buffer: Buffer },
  ) {
    const user = await this.users.syncUser(auth);
    if (!file) throw new BadRequestException("Choose a file");
    const pages = await extractDocument(file.originalname, file.buffer).catch(
      (error: unknown) => {
        const problem = documentProblem(error);
        throw problem
          ? attachmentError(
              (error as HttpException).getStatus(),
              `ATTACHMENT_${problem}`,
              (error as Error).message,
            )
          : error;
      },
    );
    const content = attachmentText(pages);
    if (!content)
      throw attachmentError(400, "ATTACHMENT_NO_TEXT", NO_READABLE_TEXT);
    if (content.length > MAX_CHAT_ATTACHMENT_CHARS)
      throw attachmentError(
        400,
        "ATTACHMENT_TOO_LONG",
        `A chat holds at most ${MAX_CHAT_ATTACHMENT_CHARS.toLocaleString("en")} characters of attached text; this file has ${content.length.toLocaleString("en")}.`,
      );
    return this.prisma.attachment.create({
      data: {
        userId: user.id,
        filename: safeFilename(file.originalname),
        byteSize: file.buffer.length,
        pageCount: pages.some((page) => page.page !== null)
          ? pages.length
          : null,
        charCount: content.length,
        content,
      },
      select: attachmentView,
    });
  }

  async remove(auth: AuthUser, id: string) {
    const user = await this.users.syncUser(auth);
    const { count } = await this.prisma.attachment.deleteMany({
      where: { id, userId: user.id, sentAt: null },
    });
    if (count) return;
    // A sent file is part of its chat's context from then on.
    if (await this.prisma.attachment.count({ where: { id, userId: user.id } }))
      throw attachmentError(
        409,
        "ATTACHMENT_SENT",
        "This attachment was sent and stays with its chat",
      );
    throw new NotFoundException("Attachment not found");
  }

  async removeUnsent(now = Date.now()) {
    try {
      const { count } = await this.prisma.attachment.deleteMany({
        where: {
          sentAt: null,
          createdAt: { lt: new Date(now - UNSENT_ATTACHMENT_TTL_MS) },
        },
      });
      if (count)
        this.logger.log(`Removed ${count} attachment(s) that were never sent`);
      return count;
    } catch (error) {
      this.logger.error(
        `Unsent attachment sweep failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }
}
