import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { auth, basePrisma, localUser, usersWith } from "../testing/fixtures";
import { extractDocument } from "../workspace/documents";
import {
  AttachmentsService,
  MAX_CHAT_ATTACHMENT_CHARS,
  UNSENT_ATTACHMENT_TTL_MS,
  attachmentText,
} from "./attachments.service";

function setup() {
  const prisma = {
    ...basePrisma(),
    attachment: {
      create: vi.fn(async ({ data }: { data: object }) => ({
        id: "attachment-1",
        ...data,
      })),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return {
    prisma,
    service: new AttachmentsService(prisma as never, usersWith(prisma)),
  };
}
const file = (originalname: string, text: string) => ({
  originalname,
  buffer: Buffer.from(text),
});

describe("chat attachments", () => {
  it("keeps only the extracted text, under a safe name, for the caller", async () => {
    const { prisma, service } = setup();
    await service.upload(auth, file("../สรุป.md", "  สวัสดี  "));
    const [args] = prisma.attachment.create.mock.calls[0] as [
      { data: object; select: object },
    ];
    expect(args.data).toEqual({
      userId: localUser.id,
      filename: ".._สรุป.md",
      byteSize: Buffer.byteLength("  สวัสดี  "),
      pageCount: null,
      charCount: 6,
      content: "สวัสดี",
    });
    // The text goes to the model, not back to the browser.
    expect(args.select).not.toHaveProperty("content");
  });

  it("marks PDF pages and leaves out empty ones", () => {
    expect(
      attachmentText([
        { page: 1, text: "Intro " },
        { page: 2, text: " " },
        { page: 3, text: "End" },
      ]),
    ).toBe("[Page 1]\nIntro\n\n[Page 3]\nEnd");
    expect(attachmentText([{ page: null, text: " plain " }])).toBe("plain");
  });

  it.each([
    { name: "payload.exe", text: "hello", code: "ATTACHMENT_TYPE" },
    { name: "empty.txt", text: "", code: "ATTACHMENT_SIZE" },
    { name: "broken.json", text: "{", code: "ATTACHMENT_UNREADABLE" },
    { name: "fake.pdf", text: "not a pdf", code: "ATTACHMENT_UNREADABLE" },
    { name: "blank.txt", text: " \n ", code: "ATTACHMENT_NO_TEXT" },
    {
      name: "long.txt",
      text: "ก".repeat(MAX_CHAT_ATTACHMENT_CHARS + 1),
      code: "ATTACHMENT_TOO_LONG",
    },
  ])("refuses $name with $code", async ({ name, text, code }) => {
    const { prisma, service } = setup();
    await expect(service.upload(auth, file(name, text))).rejects.toMatchObject({
      status: 400,
      response: { statusCode: 400, code },
    });
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it("leaves the extractor's own responses (project sources, knowledge base) without a code", async () => {
    const error = await extractDocument(
      "payload.exe",
      Buffer.from("hello"),
    ).catch((cause: HttpException) => cause);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: 400,
      message: "Supported files: TXT, MD, CSV, JSON, PDF, DOCX",
      error: "Bad Request",
    });
  });

  it("removes only the caller's unsent attachment", async () => {
    const { prisma, service } = setup();
    await service.remove(auth, "attachment-1");
    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({
      where: { id: "attachment-1", userId: localUser.id, sentAt: null },
    });
  });

  it("keeps a sent attachment and does not reveal other users' ones", async () => {
    const { prisma, service } = setup();
    prisma.attachment.deleteMany.mockResolvedValue({ count: 0 });
    prisma.attachment.count.mockResolvedValueOnce(1);
    await expect(service.remove(auth, "attachment-1")).rejects.toMatchObject({
      status: 409,
      response: { code: "ATTACHMENT_SENT" },
    });
    await expect(service.remove(auth, "foreign")).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.attachment.count).toHaveBeenLastCalledWith({
      where: { id: "foreign", userId: localUser.id },
    });
  });

  it("sweeps attachments that were never sent within a day", async () => {
    const { prisma, service } = setup();
    const now = Date.parse("2026-10-29T12:00:00Z");
    await service.removeUnsent(now);
    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({
      where: {
        sentAt: null,
        createdAt: { lt: new Date(now - UNSENT_ATTACHMENT_TTL_MS) },
      },
    });
  });
});
