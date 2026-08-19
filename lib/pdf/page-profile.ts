/**
 * Deterministic PDF page layout profiler (pdfjs-dist).
 *
 * Measures unique text coverage (union of glyph boxes), painted-image
 * coverage, and vector path density so we can route pages to text extraction
 * vs vision without rasterizing or LLM classification. Pure CPU — no canvas /
 * Docker bloat.
 */

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfDocumentInit = Parameters<typeof getDocument>[0];

export const PAGE_PROFILER_VERSION = "pdfjs-profile-v3";

/** Tunable thresholds — calibrate against the golden set (P0-4). */
export const PAGE_ROUTE_THRESHOLDS = {
  /** Pages with fewer chars than this and little text area → vision. */
  minTextChars: 40,
  /** Text bounding-box coverage below this → likely diagram/scan. */
  textAreaVisionMax: 0.12,
  /** Image paint coverage above this → vision (stamped scans, photos). */
  imageAreaVisionMin: 0.35,
  /**
   * Ignore icon/bullet-sized paints when summing image coverage (fraction of
   * page). Keeps letterhead dingbats from inflating imageAreaRatio.
   */
  minImagePaintArea: 0.015,
  /**
   * Non-trivial embedded images (photos, pasted table strips, chart bodies)
   * even on text-heavy pages → ambiguous. Calibrated to catch ~4%+ photo/chart
   * coverage without requiring low textArea.
   */
  embeddedImageAmbiguousMin: 0.04,
  /** Dense vector drawing with sparse text → blueprint / schematic. */
  vectorOpsVisionMin: 400,
  /** Ambiguous band: moderate text + some images or vectors. */
  ambiguousTextAreaMin: 0.08,
  ambiguousTextAreaMax: 0.28,
  ambiguousImageAreaMin: 0.08,
  ambiguousVectorOpsMin: 120,
} as const;

export type PageRoute = "text" | "vision" | "ambiguous";

export type PageProfile = {
  pageNo: number;
  chars: number;
  textAreaRatio: number;
  imageAreaRatio: number;
  vectorOps: number;
  hasTextLayer: boolean;
  route: PageRoute;
};

type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function roundRatio(n: number): number {
  return Math.round(clamp01(n) * 10_000) / 10_000;
}

/**
 * Route a page from profile metrics. Tuned for zero false negatives on visual
 * pages (over-escalate to vision / ambiguous rather than miss diagrams).
 */
export function routeFromProfileMetrics(input: {
  chars: number;
  textAreaRatio: number;
  imageAreaRatio: number;
  vectorOps: number;
}): PageRoute {
  const t = PAGE_ROUTE_THRESHOLDS;
  const { chars, textAreaRatio, imageAreaRatio, vectorOps } = input;

  // Pure / near-blank scan or image-only page.
  if (chars < t.minTextChars && textAreaRatio < t.textAreaVisionMax) {
    return "vision";
  }

  // Dominant painted image (scanned invoice, photo of stamp/signature).
  if (imageAreaRatio >= t.imageAreaVisionMin) {
    return "vision";
  }

  // Blueprint / floor plan: heavy vector drawing, caption-sized text.
  if (
    vectorOps >= t.vectorOpsVisionMin &&
    textAreaRatio <= t.textAreaVisionMax
  ) {
    return "vision";
  }

  // Sparse text even with more chars (caption-under-diagram edge case).
  if (textAreaRatio < t.textAreaVisionMax && vectorOps >= t.ambiguousVectorOpsMin) {
    return "vision";
  }

  // Photos / pasted snippets / chart bodies on otherwise text-heavy pages.
  // Prefer ambiguous over text so downstream can still use the text layer.
  if (imageAreaRatio >= t.embeddedImageAmbiguousMin) {
    return "ambiguous";
  }

  const ambiguous =
    (textAreaRatio >= t.ambiguousTextAreaMin &&
      textAreaRatio <= t.ambiguousTextAreaMax &&
      (imageAreaRatio >= t.ambiguousImageAreaMin ||
        vectorOps >= t.ambiguousVectorOpsMin)) ||
    (imageAreaRatio >= t.ambiguousImageAreaMin &&
      imageAreaRatio < t.imageAreaVisionMin &&
      textAreaRatio < 0.4);

  if (ambiguous) return "ambiguous";
  return "text";
}

type TextBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * Unique page coverage of axis-aligned boxes (union), not summed ink.
 * Summing glyph boxes over-counts dense/overlapping text and made mixed
 * pages look ~90% text when selectable coverage was actually ~20%.
 */
export function coverageRatioFromBoxes(
  boxes: TextBox[],
  pageWidth: number,
  pageHeight: number,
  cellSize = 2,
): number {
  const pw = Math.max(1, pageWidth);
  const ph = Math.max(1, pageHeight);
  const cell = Math.max(0.5, cellSize);
  const cols = Math.max(1, Math.ceil(pw / cell));
  const rows = Math.max(1, Math.ceil(ph / cell));
  const grid = new Uint8Array(cols * rows);
  let marked = 0;

  for (const box of boxes) {
    const x0 = Math.max(0, Math.min(pw, Math.min(box.x0, box.x1)));
    const x1 = Math.max(0, Math.min(pw, Math.max(box.x0, box.x1)));
    const y0 = Math.max(0, Math.min(ph, Math.min(box.y0, box.y1)));
    const y1 = Math.max(0, Math.min(ph, Math.max(box.y0, box.y1)));
    if (x1 <= x0 || y1 <= y0) continue;

    const c0 = Math.max(0, Math.floor(x0 / cell));
    const c1 = Math.min(cols, Math.ceil(x1 / cell));
    const r0 = Math.max(0, Math.floor(y0 / cell));
    const r1 = Math.min(rows, Math.ceil(y1 / cell));
    for (let r = r0; r < r1; r += 1) {
      const rowOffset = r * cols;
      for (let c = c0; c < c1; c += 1) {
        const i = rowOffset + c;
        if (!grid[i]) {
          grid[i] = 1;
          marked += 1;
        }
      }
    }
  }

  return roundRatio(marked / (cols * rows));
}

function estimateTextAreaRatio(
  items: Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>,
  pageWidth: number,
  pageHeight: number,
): { chars: number; textAreaRatio: number } {
  let chars = 0;
  const boxes: TextBox[] = [];

  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    chars += str.length;
    if (!str.trim()) continue;

    const transform = item.transform;
    if (!transform || transform.length < 6) continue;

    const width = typeof item.width === "number" ? item.width : 0;
    // pdfjs height is font size in text space; transform scale gives page units.
    const fontHeight = Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || 0;
    const scaleX = Math.hypot(transform[0] ?? 0, transform[1] ?? 0) || 1;
    const w = Math.abs(width * scaleX);
    const h = Math.abs(fontHeight) || Math.abs(item.height ?? 0);
    if (w > 0 && h > 0) {
      const x0 = transform[4] ?? 0;
      const y0 = transform[5] ?? 0;
      boxes.push({ x0, y0, x1: x0 + w, y1: y0 + h });
    }
  }

  return {
    chars,
    textAreaRatio: coverageRatioFromBoxes(boxes, pageWidth, pageHeight),
  };
}

type ImageLookup = {
  width?: number;
  height?: number;
};

function resolveImageSize(
  objId: unknown,
  objs: { get: (id: string) => unknown },
  commonObjs: { get: (id: string) => unknown },
): { width: number; height: number } | null {
  if (typeof objId !== "string") return null;
  let raw: unknown;
  try {
    raw = objs.get(objId) ?? commonObjs.get(objId);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const img = raw as ImageLookup;
  if (
    typeof img.width === "number" &&
    img.width > 0 &&
    typeof img.height === "number" &&
    img.height > 0
  ) {
    return { width: img.width, height: img.height };
  }
  return null;
}

function estimateImageAndVector(
  fnArray: number[],
  argsArray: unknown[],
  pageWidth: number,
  pageHeight: number,
  objs: { get: (id: string) => unknown },
  commonObjs: { get: (id: string) => unknown },
): { imageAreaRatio: number; vectorOps: number } {
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const minPaintArea = PAGE_ROUTE_THRESHOLDS.minImagePaintArea;
  let imageArea = 0;
  let vectorOps = 0;
  let ctm: Affine = [...IDENTITY];
  const stack: Affine[] = [];

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i]!;
    const args = argsArray[i] as unknown[] | undefined;

    if (fn === OPS.save) {
      stack.push([...ctm]);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [...IDENTITY];
      continue;
    }
    if (fn === OPS.transform && args && args.length >= 6) {
      const m: Affine = [
        Number(args[0]) || 0,
        Number(args[1]) || 0,
        Number(args[2]) || 0,
        Number(args[3]) || 0,
        Number(args[4]) || 0,
        Number(args[5]) || 0,
      ];
      ctm = multiply(ctm, m);
      continue;
    }
    if (fn === OPS.constructPath) {
      vectorOps += 1;
      continue;
    }

    const isImage =
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObjectGroup;

    if (!isImage) continue;

    // Unit square [0,1]×[0,1] transformed by CTM → display size.
    const scaleX = Math.hypot(ctm[0], ctm[1]);
    const scaleY = Math.hypot(ctm[2], ctm[3]);
    let w = scaleX;
    let h = scaleY;

    // When the image object is available, refine with pixel aspect.
    const size = resolveImageSize(args?.[0], objs, commonObjs);
    if (size && (scaleX < 2 || scaleY < 2)) {
      // Some producers leave identity-ish CTM and encode size in the image.
      w = Math.max(w, size.width);
      h = Math.max(h, size.height);
    }

    if (w > 0 && h > 0) {
      const paintArea = Math.min(pageArea, w * h);
      // Drop icon/bullet paints; keep photos, chart bodies, pasted strips.
      if (paintArea / pageArea < minPaintArea) continue;
      imageArea += paintArea;
    } else {
      // Unknown size but an image paint occurred — assume a meaningful stamp.
      imageArea += pageArea * 0.15;
    }
  }

  return {
    imageAreaRatio: roundRatio(imageArea / pageArea),
    vectorOps,
  };
}

async function profileSinglePage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  pageNo: number,
): Promise<PageProfile> {
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width as number;
  const pageHeight = viewport.height as number;

  const [textContent, operatorList] = await Promise.all([
    page.getTextContent({ includeMarkedContent: false }),
    page.getOperatorList({ intent: "display" }),
  ]);

  const { chars, textAreaRatio } = estimateTextAreaRatio(
    textContent.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>,
    pageWidth,
    pageHeight,
  );

  const { imageAreaRatio, vectorOps } = estimateImageAndVector(
    operatorList.fnArray as number[],
    operatorList.argsArray as unknown[],
    pageWidth,
    pageHeight,
    page.objs,
    page.commonObjs,
  );

  const route = routeFromProfileMetrics({
    chars,
    textAreaRatio,
    imageAreaRatio,
    vectorOps,
  });

  return {
    pageNo,
    chars,
    textAreaRatio,
    imageAreaRatio,
    vectorOps,
    hasTextLayer: chars > 0,
    route,
  };
}

/**
 * Profile every page of a PDF. Does not write to the database.
 */
export async function profilePdfPages(bytes: Buffer): Promise<PageProfile[]> {
  const data = new Uint8Array(bytes);
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    // Owner-restricted condo PDFs are still readable for layout metrics.
    password: "",
  } as PdfDocumentInit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypted/i.test(message)) {
      const retry = getDocument({
        data: new Uint8Array(bytes),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
        password: "",
      } as PdfDocumentInit);
      doc = await retry.promise;
    } else {
      throw error;
    }
  }

  try {
    const pageCount = doc.numPages as number;
    const profiles: PageProfile[] = [];
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      try {
        profiles.push(await profileSinglePage(page, pageNo));
      } finally {
        page.cleanup?.();
      }
    }
    return profiles;
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      // pdfjs versions differ on destroy; ignore cleanup failures.
    }
    try {
      await doc.cleanup?.();
    } catch {
      // ignore
    }
  }
}

export function summarizeProfiles(profiles: PageProfile[]): {
  totalPages: number;
  text: number;
  vision: number;
  ambiguous: number;
  visionOrAmbiguousRate: number;
} {
  let text = 0;
  let vision = 0;
  let ambiguous = 0;
  for (const p of profiles) {
    if (p.route === "text") text += 1;
    else if (p.route === "vision") vision += 1;
    else ambiguous += 1;
  }
  const totalPages = profiles.length;
  return {
    totalPages,
    text,
    vision,
    ambiguous,
    visionOrAmbiguousRate:
      totalPages === 0 ? 0 : (vision + ambiguous) / totalPages,
  };
}
