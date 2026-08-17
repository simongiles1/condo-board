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
  const copied = await dst.copyPages(
    src,
    uniqueSorted.map((n) => n - 1),
  );
  for (const page of copied) {
    dst.addPage(page);
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
