/** Lazy-load pdf.js in the browser only (avoids SSR DOMMatrix errors). */

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

const bufferCache = new Map<string, Promise<ArrayBuffer>>();

type ClipRenderHandle = {
  cancel: () => void;
};

const activeClipRenders = new WeakMap<HTMLCanvasElement, ClipRenderHandle>();
const activeFullPageRenders = new WeakMap<HTMLCanvasElement, ClipRenderHandle>();

/** Cancel an in-flight clip or full-page render without clearing the painted bitmap. */
export function cancelPdfCanvasRender(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  activeClipRenders.get(canvas)?.cancel();
  activeClipRenders.delete(canvas);
  activeFullPageRenders.get(canvas)?.cancel();
  activeFullPageRenders.delete(canvas);
}

/** Stop any render and drop the canvas bitmap to free GPU memory. */
export function releasePdfCanvas(canvas: HTMLCanvasElement | null): void {
  cancelPdfCanvasRender(canvas);
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

async function destroyPdfDocument(doc: {
  destroy?: () => void | Promise<void>;
}): Promise<void> {
  try {
    if (typeof doc.destroy === "function") {
      await doc.destroy();
    }
  } catch {
    /* pdf.js document teardown differs by version; the page already painted. */
  }
}

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

export function loadPdfBuffer(url: string): Promise<ArrayBuffer> {
  let pending = bufferCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) {
        bufferCache.delete(url);
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not load PDF.");
      }
      return response.arrayBuffer();
    });
    bufferCache.set(url, pending);
  }
  return pending;
}

/** Drop cached PDF bytes so a closed viewer session can release memory. */
export function releasePdfBuffers(urls: Iterable<string>): void {
  flushPendingPdfRenders();
  for (const url of urls) {
    bufferCache.delete(url);
  }
}

/** Drop every cached PDF byte (e.g. after closing a heavy full-screen session). */
export function clearPdfBufferCache(): void {
  flushPendingPdfRenders();
  bufferCache.clear();
}

export type PdfPageRenderInfo = {
  canvasWidth: number;
  canvasHeight: number;
  pageWidthPt: number;
  pageHeightPt: number;
  scale: number;
};

export type PdfClipRenderParams = {
  canvasWidth: number;
  canvasHeight: number;
  renderScale: number;
  offsetX: number;
  offsetY: number;
  /** Omit for a transparent clip (stacked alignment overlays). */
  background?: string;
};

function isRenderCancelled(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    String((error as { name: unknown }).name) === "RenderingCancelledException"
  );
}

export async function renderPdfPageToCanvas(
  data: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.25,
): Promise<PdfPageRenderInfo | void> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      background: "#ffffff",
    });
    activeFullPageRenders.set(canvas, { cancel: () => task.cancel() });
    try {
      await task.promise;
      return {
        canvasWidth: viewport.width,
        canvasHeight: viewport.height,
        pageWidthPt: unscaled.width,
        pageHeightPt: unscaled.height,
        scale,
      };
    } catch (error) {
      if (isRenderCancelled(error)) return;
      throw error;
    } finally {
      activeFullPageRenders.delete(canvas);
      page.cleanup?.();
    }
  } finally {
    await destroyPdfDocument(doc);
  }
}

type PageRenderJob = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const MAX_CONCURRENT_PAGE_RENDERS = 3;
let activePageRenders = 0;
let pageRenderGeneration = 0;
const pageRenderWaitQueue: PageRenderJob[] = [];

function drainPageRenderQueue(): void {
  if (typeof document !== "undefined" && document.hidden) return;
  while (
    activePageRenders < MAX_CONCURRENT_PAGE_RENDERS &&
    pageRenderWaitQueue.length > 0
  ) {
    const job = pageRenderWaitQueue.shift();
    if (!job) return;
    const generation = pageRenderGeneration;
    activePageRenders += 1;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        if (generation !== pageRenderGeneration) return;
        activePageRenders -= 1;
        drainPageRenderQueue();
      });
  }
}

/** Unstick compare preloads after a background browser tab throttled in-flight renders. */
export function wakePageRenderQueue(): void {
  pageRenderGeneration += 1;
  activePageRenders = 0;
  drainPageRenderQueue();
}

/** Limit concurrent full-page raster jobs so compare preloads keep making progress. */
export function queueRenderPdfPageToCanvas(
  data: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.25,
): Promise<PdfPageRenderInfo | void> {
  return new Promise((resolve, reject) => {
    pageRenderWaitQueue.push({
      run: () => renderPdfPageToCanvas(data, pageNumber, canvas, scale),
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    drainPageRenderQueue();
  });
}

let clipRenderQueue: Promise<unknown> = Promise.resolve();

/**
 * Drop queued raster work so closing a viewer or switching plans does not keep
 * painting stale PDFs (main freeze source when exiting full screen).
 */
export function flushPendingPdfRenders(): void {
  pageRenderGeneration += 1;
  activePageRenders = 0;
  const pending = pageRenderWaitQueue.splice(0);
  for (const job of pending) {
    job.reject(
      Object.assign(new Error("Rendering cancelled"), {
        name: "RenderingCancelledException",
      }),
    );
  }
  clipRenderQueue = Promise.resolve();
}

/**
 * Rasterize the visible viewport onto `canvas` (screen-sized, not full-page).
 * One clip at a time: pdf.js will not paint two jobs onto the same canvas.
 */
export function renderPdfPageClipToCanvas(
  url: string,
  canvas: HTMLCanvasElement,
  params: PdfClipRenderParams,
): Promise<boolean> {
  activeClipRenders.get(canvas)?.cancel();
  activeClipRenders.delete(canvas);

  const job = clipRenderQueue.then(
    () => renderPdfPageClipToCanvasNow(url, canvas, params),
    () => renderPdfPageClipToCanvasNow(url, canvas, params),
  );
  clipRenderQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function renderPdfPageClipToCanvasNow(
  url: string,
  canvas: HTMLCanvasElement,
  params: PdfClipRenderParams,
): Promise<boolean> {
  const buffer = await loadPdfBuffer(url);
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
  try {
    const page = await doc.getPage(1);
    canvas.width = Math.max(1, params.canvasWidth);
    canvas.height = Math.max(1, params.canvasHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const viewport = page.getViewport({ scale: params.renderScale });
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, params.offsetX, params.offsetY],
      ...(params.background !== undefined
        ? { background: params.background }
        : {}),
    });
    activeClipRenders.set(canvas, { cancel: () => task.cancel() });
    try {
      await task.promise;
      return true;
    } catch (error) {
      if (isRenderCancelled(error)) return false;
      throw error;
    } finally {
      activeClipRenders.delete(canvas);
      page.cleanup?.();
    }
  } catch (error) {
    if (isRenderCancelled(error)) return false;
    throw error;
  } finally {
    await destroyPdfDocument(doc);
  }
}
