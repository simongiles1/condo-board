/** US Letter page size in points (width × height). */
export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;

export type PdfMargins = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Distance from page top to the running-header horizontal rule (pt). */
  headerRuleTop: number;
};

export const DEFAULT_PDF_MARGINS: PdfMargins = {
  top: 72,
  bottom: 72,
  left: 72,
  right: 72,
  headerRuleTop: 71,
};

/** Extra top padding on continuation pages for running header + rule. */
export const CONTINUATION_PAGE_EXTRA = 22;

export const PDF_MARGINS_STORAGE_KEY = "condo-board-pdf-margins";

export function loadPdfMargins(): PdfMargins {
  if (typeof window === "undefined") return DEFAULT_PDF_MARGINS;

  try {
    const raw = localStorage.getItem(PDF_MARGINS_STORAGE_KEY);
    if (!raw) return DEFAULT_PDF_MARGINS;
    return normalizePdfMargins(JSON.parse(raw) as Partial<PdfMargins>);
  } catch {
    return DEFAULT_PDF_MARGINS;
  }
}

export function savePdfMargins(margins: PdfMargins): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    PDF_MARGINS_STORAGE_KEY,
    JSON.stringify(normalizePdfMargins(margins)),
  );
}

export function normalizePdfMargins(
  input: Partial<Record<keyof PdfMargins, number | string>> | null | undefined,
): PdfMargins {
  const clamp = (value: unknown, fallback: number, max = 144) => {
    if (value === "" || value === null || value === undefined) return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(0, Math.round(n)));
  };

  return {
    top: clamp(input?.top, DEFAULT_PDF_MARGINS.top),
    bottom: clamp(input?.bottom, DEFAULT_PDF_MARGINS.bottom),
    left: clamp(input?.left, DEFAULT_PDF_MARGINS.left),
    right: clamp(input?.right, DEFAULT_PDF_MARGINS.right),
    headerRuleTop: clamp(
      input?.headerRuleTop,
      DEFAULT_PDF_MARGINS.headerRuleTop,
      LETTER_HEIGHT,
    ),
  };
}

export function parsePdfMarginsFromSearchParams(
  params: URLSearchParams,
): PdfMargins {
  return normalizePdfMargins({
    top: params.get("top") ?? undefined,
    bottom: params.get("bottom") ?? undefined,
    left: params.get("left") ?? undefined,
    right: params.get("right") ?? undefined,
    headerRuleTop: params.get("headerRuleTop") ?? undefined,
  });
}

export function pdfMarginsSearchParams(margins: PdfMargins): string {
  return new URLSearchParams({
    top: String(margins.top),
    bottom: String(margins.bottom),
    left: String(margins.left),
    right: String(margins.right),
    headerRuleTop: String(margins.headerRuleTop),
  }).toString();
}

export type PdfMarginLayout = {
  margins: PdfMargins;
  pagePaddingTop: number;
  pageOneTitleOffset: number;
  contentWidth: number;
  headerCorpTop: number;
  headerMeetingTypeTop: number;
  headerDateTop: number;
  headerRuleTop: number;
};

export function computeMarginLayout(margins: PdfMargins): PdfMarginLayout {
  const pagePaddingTop =
    margins.headerRuleTop + 1 + CONTINUATION_PAGE_EXTRA;

  return {
    margins,
    pagePaddingTop,
    pageOneTitleOffset: -(pagePaddingTop - margins.top),
    contentWidth: LETTER_WIDTH - margins.left - margins.right,
    headerCorpTop: margins.top - 36,
    headerMeetingTypeTop: margins.top - 24,
    headerDateTop: margins.top - 12,
    headerRuleTop: margins.headerRuleTop,
  };
}
