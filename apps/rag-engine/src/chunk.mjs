// Splits a document's extracted sections into passages with the tenant's chunk size and overlap.
// Text sections (txt, md, PDF pages) use overlapping windows that keep their page number; a CSV
// row is one passage unless it is longer than a chunk.
import { Fault } from "./errors.mjs";
import { FILE_TYPES } from "./settings.mjs";

const MAX_SECTIONS = 10000;
const MAX_TITLE = 300;

/** Validates the sections a tenant API extracted from an uploaded file. */
export function documentInput(body) {
  const bad = (message) => new Fault(400, "invalid_document", message);
  if (!body || typeof body !== "object") throw bad("Document body is required");
  const { filename, type, fileBytes, sections, sensitiveFindings = 0 } = body;
  if (typeof filename !== "string" || !filename.trim() || filename.length > 255)
    throw bad("A filename of up to 255 characters is required");
  if (!FILE_TYPES.includes(type)) throw bad(`File type must be one of: ${FILE_TYPES.join(", ")}`);
  if (!Number.isInteger(fileBytes) || fileBytes < 1) throw bad("fileBytes must be a positive whole number");
  if (!Number.isInteger(sensitiveFindings) || sensitiveFindings < 0)
    throw bad("sensitiveFindings must be a whole number");
  if (!Array.isArray(sections) || !sections.length || sections.length > MAX_SECTIONS)
    throw bad(`A document needs 1 to ${MAX_SECTIONS} sections`);
  const clean = sections.map((section, index) => {
    if (!section || typeof section.text !== "string")
      throw bad(`Section ${index + 1} has no text`);
    if (section.title !== undefined && (typeof section.title !== "string" || section.title.length > MAX_TITLE))
      throw bad(`Section ${index + 1} title must be text of up to ${MAX_TITLE} characters`);
    if (section.page !== undefined && section.page !== null && (!Number.isInteger(section.page) || section.page < 1))
      throw bad(`Section ${index + 1} page must be a positive whole number`);
    return {
      text: section.text.replaceAll("\0", ""),
      ...(section.title ? { title: section.title.trim() } : {}),
      ...(section.page ? { page: section.page } : {}),
    };
  });
  if (!clean.some((section) => section.text.trim()))
    throw bad("No text was found in this document. Scanned PDFs need OCR, which this POC does not include.");
  // Counted from what is stored, not from what the caller reports.
  const textBytes = clean.reduce(
    (sum, section) => sum + Buffer.byteLength(section.text) + Buffer.byteLength(section.title ?? ""),
    0,
  );
  return { filename: filename.trim(), type, fileBytes, sensitiveFindings, sections: clean, textBytes };
}

/** Passages with ordinal, page and title, ready to embed. */
export function chunkSections(document, { chunkSize, chunkOverlap }) {
  const step = chunkSize - chunkOverlap;
  const chunks = [];
  for (const section of document.sections) {
    const text = section.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) continue;
    const title = section.title || document.filename;
    for (let start = 0; start < text.length; start += step) {
      const content = text.slice(start, start + chunkSize).trim();
      if (content) chunks.push({ ordinal: chunks.length, page: section.page ?? null, title, content });
      if (start + chunkSize >= text.length) break;
    }
  }
  return chunks;
}
