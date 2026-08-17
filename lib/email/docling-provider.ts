/**
 * Docling backend for extraction backfill: local sidecar vs IBM watsonx API.
 */

export type DoclingProvider = "sidecar" | "ibm";

/** New extraction-backfill runs default to hosted IBM watsonx. */
export const DEFAULT_DOCLING_PROVIDER: DoclingProvider = "ibm";

/** IBM list price: $4 per 1,000 pages. */
export const IBM_DOCLING_USD_PER_PAGE = 0.004;

/** IBM 30-day watsonx Docling trial allowance. */
export const IBM_DOCLING_TRIAL_PAGES = 5000;

export function ibmDoclingUsdPerPage(): number {
  const raw = process.env.DOCLING_IBM_USD_PER_PAGE?.trim();
  if (!raw) return IBM_DOCLING_USD_PER_PAGE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : IBM_DOCLING_USD_PER_PAGE;
}

export function isDoclingProvider(value: unknown): value is DoclingProvider {
  return value === "sidecar" || value === "ibm";
}

export function normalizeDoclingProvider(
  value: string | null | undefined,
): DoclingProvider {
  return value === "ibm" ? "ibm" : "sidecar";
}

export function ibmDoclingCostUsd(pageCount: number): number {
  return Math.max(0, pageCount) * ibmDoclingUsdPerPage();
}
