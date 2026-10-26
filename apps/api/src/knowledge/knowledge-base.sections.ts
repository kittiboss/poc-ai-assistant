import { BadRequestException } from "@nestjs/common";
import {
  PRODUCT_COLUMNS,
  ProductCsvError,
  parseCsv,
  parseProductCsv,
  productPassage,
} from "@enterprise/shared";
import { extname } from "node:path";
import { extractDocument } from "../workspace/documents";

/** What the central RAG engine stores per document: extracted text, never the file itself. */
export type Section = { text: string; title?: string; page?: number };
export const KNOWLEDGE_FILE_TYPES = ["csv", "txt", "md", "pdf"] as const;
export type KnowledgeFileType = (typeof KNOWLEDGE_FILE_TYPES)[number];

export function fileType(filename: string): KnowledgeFileType | null {
  const extension = extname(filename).slice(1).toLowerCase();
  const type = extension === "markdown" ? "md" : extension;
  return (KNOWLEDGE_FILE_TYPES as readonly string[]).includes(type)
    ? (type as KnowledgeFileType)
    : null;
}

/**
 * Extracts text in this deployment (a PDF is parsed by the bounded worker of the document feature),
 * so untrusted files never reach the shared engine. PDF pages keep their page numbers.
 */
export async function extractSections(
  filename: string,
  buffer: Buffer,
  type: KnowledgeFileType,
): Promise<Section[]> {
  if (type === "csv") return csvSections(decode(buffer), filename);
  const pages = await extractDocument(`document.${type}`, buffer);
  return pages
    .filter((page) => page.text.trim())
    .map((page) => ({ text: page.text, ...(page.page ? { page: page.page } : {}) }));
}

function decode(buffer: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException("Use a UTF-8 encoded CSV file");
  }
}

/**
 * One section per row as "column: value" lines. A file with the product catalog's columns keeps
 * the catalog's passage format, so the same products are found the same way as before.
 */
export function csvSections(text: string, filename: string): Section[] {
  let rows: string[][];
  try {
    rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
  if (rows.length < 2)
    throw new BadRequestException(
      "The CSV needs a header row and at least one data row",
    );
  const header = rows[0].map((cell) => cell.trim());
  const lower = header.map((cell) => cell.toLowerCase());
  if (
    lower.length === PRODUCT_COLUMNS.length &&
    PRODUCT_COLUMNS.every((column) => lower.includes(column))
  ) {
    try {
      return parseProductCsv(text).map((product) => productPassage(product));
    } catch (error) {
      if (error instanceof ProductCsvError)
        throw new BadRequestException({
          message: error.message,
          errors: error.errors,
        });
      throw error;
    }
  }
  const titleColumn = lower.findIndex((cell) =>
    ["name", "title", "subject", "product"].includes(cell),
  );
  return rows
    .slice(1)
    .map((row, index) => ({
      title: (
        (titleColumn >= 0 && row[titleColumn]?.trim()) ||
        `${filename} row ${index + 1}`
      ).slice(0, 300),
      text: header
        .map((column, i) =>
          row[i]?.trim() ? `${column || `Column ${i + 1}`}: ${row[i].trim()}` : null,
        )
        .filter(Boolean)
        .join("\n"),
    }))
    .filter((section) => section.text);
}
