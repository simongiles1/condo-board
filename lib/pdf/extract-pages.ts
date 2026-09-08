import { PDFDocument } from "pdf-lib";

/**
 * pdf-lib logs every recovered xref/object on malformed PDFs. Condo scans and
 * Word exports trip this constantly; the parse still succeeds. Mute those two
 * strings only, with a reentrant depth counter so overlapping loads stay quiet.
 */
const PDF_LIB_PARSE_NOISE =
  /^(Trying to parse invalid object:|Invalid object ref:)/;

let muteDepth = 0;
let originalWarn: typeof console.warn | null = null;

function beginMutePdfLibParseWarnings() {
  if (muteDepth === 0) {
    originalWarn = console.warn.bind(console);
    console.warn = (...args: Parameters<typeof console.warn>) => {
      const first = args[0];
      if (typeof first === "string" && PDF_LIB_PARSE_NOISE.test(first)) {
        return;
      }
      originalWarn!(...args);
    };
  }
  muteDepth += 1;
}

function endMutePdfLibParseWarnings() {
  muteDepth = Math.max(0, muteDepth - 1);
  if (muteDepth === 0 && originalWarn) {
    console.warn = originalWarn;
    originalWarn = null;
  }
}

/** Load a PDF for page copy/count. Owner-restricted files are still readable. */
export async function loadPdfLibDocument(
  source: ArrayBuffer | Uint8Array,
): Promise<PDFDocument> {
  beginMutePdfLibParseWarnings();
  try {
    return await PDFDocument.load(source, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
  } finally {
    endMutePdfLibParseWarnings();
  }
}

/** Copy 1-based page numbers from `source` into a new PDF byte array. */
export async function extractPdfPages(
  source: ArrayBuffer | Uint8Array,
  pageNumbers: number[],
): Promise<Uint8Array> {
  const uniqueSorted = [
    ...new Set(
      pageNumbers.filter((n) => Number.isInteger(n) && n >= 1),
    ),
  ].sort((a, b) => a - b);

  if (uniqueSorted.length === 0) {
    throw new Error("Select at least one page to include.");
  }

  const src = await loadPdfLibDocument(source);
  const total = src.getPageCount();

  for (const n of uniqueSorted) {
    if (n > total) {
      throw new Error(`Page ${n} is out of range (document has ${total} pages).`);
    }
  }

  const dst = await PDFDocument.create();
  const failed: number[] = [];

  // Copy one page at a time — batch copyPages throws on the first bad page ref
  // (pdf-lib: "Expected instance of …, but got instance of undefined").
  for (const pageNo of uniqueSorted) {
    try {
      const [copied] = await dst.copyPages(src, [pageNo - 1]);
      if (!copied) {
        failed.push(pageNo);
        continue;
      }
      dst.addPage(copied);
    } catch {
      failed.push(pageNo);
    }
  }

  if (dst.getPageCount() === 0) {
    const detail =
      failed.length === 1
        ? `page ${failed[0]}`
        : `pages ${failed.join(", ")}`;
    throw new Error(
      `Could not extract PDF ${detail} (corrupt or unsupported page structure).`,
    );
  }

  if (failed.length > 0) {
    throw new Error(
      `Could not extract PDF pages ${failed.join(", ")} (corrupt or unsupported page structure).`,
    );
  }

  return dst.save();
}

export function defaultInitialPageSelection(
  pageCount: number,
  defaultThrough = 20,
): number[] {
  if (pageCount <= 0) return [];
  const end = Math.min(pageCount, defaultThrough);
  return Array.from({ length: end }, (_, i) => i + 1);
}
