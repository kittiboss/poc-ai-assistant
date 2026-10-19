import { BadRequestException, HttpException } from "@nestjs/common";
import { extname, join } from "node:path";
import { Worker } from "node:worker_threads";

export type Page = { text: string; page: number | null };
let extracting = false;

export async function extractDocument(
  filename: string,
  buffer: Buffer,
): Promise<Page[]> {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!["txt", "md", "csv", "json", "pdf", "docx"].includes(extension))
    throw new BadRequestException(
      "Supported files: TXT, MD, CSV, JSON, PDF, DOCX",
    );
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new BadRequestException("Upload a non-empty file up to 5 MB");
  if (!["pdf", "docx"].includes(extension)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new BadRequestException("Use UTF-8 text");
    }
    if (text.includes("\0") || text.length > 200_000)
      throw new BadRequestException("Use text up to 200,000 characters");
    if (extension === "json") {
      try {
        JSON.parse(text);
      } catch {
        throw new BadRequestException("Invalid JSON");
      }
    }
    return [{ text, page: null }];
  }
  if (extension === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-")
    throw new BadRequestException("Invalid PDF");
  if (extension === "docx" && buffer.subarray(0, 2).toString() !== "PK")
    throw new BadRequestException("Invalid DOCX");
  if (extracting)
    throw new HttpException(
      "Another document is processing; please retry shortly.",
      429,
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
        reject(new BadRequestException("Document processing timed out"));
      }, 20_000);
      worker.once("message", (data: { pages?: Page[]; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        data.pages
          ? resolve(data.pages)
          : reject(new BadRequestException(data.error));
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(
          new BadRequestException(
            "Document processing failed or exceeded memory limit",
          ),
        );
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(new BadRequestException("Document processing stopped"));
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
  if (!chunks.length)
    throw new BadRequestException(
      "No readable text found. Scanned PDFs need OCR, which this POC does not include.",
    );
  if (chunks.length > 300)
    throw new BadRequestException("Document is too large");
  return chunks;
}
