import { parentPort, workerData } from "node:worker_threads";
import { extractRawText } from "mammoth";

/** Over the extraction limits; anything else thrown means the document could not be read. */
class TooLong extends Error {}

async function extract() {
  const bytes = new Uint8Array(workerData.bytes);
  if (workerData.extension === "docx") {
    const result = await extractRawText({ buffer: Buffer.from(bytes) });
    if (result.value.length > 200_000)
      throw new TooLong("Document exceeds 200,000 extracted characters");
    return [{ text: result.value, page: null }];
  }
  // Keep native ESM import in this CommonJS build. The module name is constant.
  const pdfjs = await (new Function(
    'return import("pdfjs-dist/legacy/build/pdf.mjs")',
  )() as Promise<typeof import("pdfjs-dist")>);
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > 100) throw new TooLong("PDF is limited to 100 pages");
    const pages: { text: string; page: number }[] = [];
    let count = 0;
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      count += text.length;
      if (count > 200_000)
        throw new TooLong("Document exceeds 200,000 extracted characters");
      pages.push({ text, page });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
extract()
  .then((pages) => parentPort?.postMessage({ pages }))
  .catch((error) =>
    parentPort?.postMessage({
      error:
        "Cannot extract document. Use a valid text PDF (up to 100 pages) or DOCX with at most 200,000 characters.",
      problem: error instanceof TooLong ? "TOO_LONG" : "UNREADABLE",
    }),
  );
