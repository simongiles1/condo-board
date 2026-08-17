/** Lazy-load pdf.js in the browser only (avoids SSR DOMMatrix errors). */

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export async function getPdfjs(): Promise<PdfJsModule> {
  if (typeof window === "undefined") {
    throw new Error("PDF preview is only available in the browser.");
  }

  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      // Avoid `new URL("pdfjs-dist/...", import.meta.url)` — Next/Webpack treats
      // that as an ESM package resolution and fails (import-esm-externals).
      // Pin the worker to the same package version via CDN instead.
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }

  return pdfjsPromise;
}

export async function renderPdfPageToCanvas(
  data: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.25,
): Promise<void> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
}
