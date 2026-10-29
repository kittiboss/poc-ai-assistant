import { BadRequestException, HttpException } from "@nestjs/common";
import { extname, join } from "node:path";
import { Worker } from "node:worker_threads";

export type Page = { text: string; page: number | null };
/** Why a document was refused. Chat attachments turn it into an error code the web words itself. */
export type DocumentProblem =
  | "TYPE"
  | "SIZE"
  | "UNREADABLE"
  | "NO_TEXT"
  | "TOO_LONG"
  | "BUSY";
export const NO_READABLE_TEXT =
  "No readable text found. Scanned PDFs need OCR, which this POC does not include.";
let extracting = false;

/** The response is the same as without a problem; only callers that read `problem` see it. */
function refuse(problem: DocumentProblem, message: string) {
  const error =
    problem === "BUSY"
      ? new HttpException(message, 429)
      : new BadRequestException(message);
  return Object.assign(error, { problem });
}

export function documentProblem(error: unknown) {
  return error instanceof HttpException
    ? (error as { problem?: DocumentProblem }).problem
    : undefined;
}

/** A display name only: no path separators or control characters. */
export function safeFilename(name: string) {
  return name.replace(/[\\/\x00-\x1F]/g, "_").slice(0, 200);
}

export async function extractDocument(
  filename: string,
  buffer: Buffer,
): Promise<Page[]> {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!["txt", "md", "csv", "json", "pdf", "docx"].includes(extension))
    throw refuse("TYPE", "Supported files: TXT, MD, CSV, JSON, PDF, DOCX");
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw refuse("SIZE", "Upload a non-empty file up to 5 MB");
  if (!["pdf", "docx"].includes(extension)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw refuse("UNREADABLE", "Use UTF-8 text");
    }
    if (text.includes("\0") || text.length > 200_000)
      throw refuse(
        text.includes("\0") ? "UNREADABLE" : "TOO_LONG",
        "Use text up to 200,000 characters",
      );
    if (extension === "json") {
      try {
        JSON.parse(text);
      } catch {
        throw refuse("UNREADABLE", "Invalid JSON");
      }
    }
    return [{ text, page: null }];
  }
  if (extension === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-")
    throw refuse("UNREADABLE", "Invalid PDF");
  if (extension === "docx" && buffer.subarray(0, 2).toString() !== "PK")
    throw refuse("UNREADABLE", "Invalid DOCX");
  if (extracting)
    throw refuse(
      "BUSY",
      "Another document is processing; please retry shortly.",
    );
  extracting = true;
  try {
    return await new Promise<Page[]>((resolve, reject) => {
      const worker = new Worker(join(__dirname, "extract.worker.js"), {
        workerData: { bytes: buffer, extension },
        resourceLimits: { maxOldGenerationSizeMb: 192 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(refuse("UNREADABLE", "Document processing timed out"));
      }, 20_000);
      worker.once(
        "message",
        (data: {
          pages?: Page[];
          error?: string;
          problem?: DocumentProblem;
        }) => {
          clearTimeout(timer);
          void worker.terminate();
          data.pages
            ? resolve(data.pages)
            : reject(
                refuse(
                  data.problem ?? "UNREADABLE",
                  data.error ?? "Cannot extract document",
                ),
              );
        },
      );
      worker.once("error", () => {
        clearTimeout(timer);
        reject(
          refuse(
            "UNREADABLE",
            "Document processing failed or exceeded memory limit",
          ),
        );
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(refuse("UNREADABLE", "Document processing stopped"));
      });
    });
  } finally {
    extracting = false;
  }
}

export function chunkPages(pages: Page[]) {
  const chunks: { content: string; page: number | null; ordinal: number }[] =
    [];
  for (const page of pages) {
    const text = page.text.replace(/\0/g, "").trim();
    for (let start = 0; start < text.length; start += 1100) {
      chunks.push({
        content: text.slice(start, start + 1400),
        page: page.page,
        ordinal: chunks.length,
      });
      if (start + 1400 >= text.length) break;
    }
  }
  if (!chunks.length) throw refuse("NO_TEXT", NO_READABLE_TEXT);
  if (chunks.length > 300) throw refuse("TOO_LONG", "Document is too large");
  return chunks;
}
