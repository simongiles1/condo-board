/** Shared page size and helpers for Entities registry lists. */

export const ENTITY_REGISTRY_PAGE_SIZE = 100;

export function entityListPageCount(
  total: number,
  pageSize: number = ENTITY_REGISTRY_PAGE_SIZE,
): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampEntityListPage(
  page: number,
  total: number,
  pageSize: number = ENTITY_REGISTRY_PAGE_SIZE,
): number {
  const pages = entityListPageCount(total, pageSize);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(pages, Math.floor(page));
}

export function sliceEntityListPage<T>(
  items: readonly T[],
  page: number,
  pageSize: number = ENTITY_REGISTRY_PAGE_SIZE,
): T[] {
  const safePage = clampEntityListPage(page, items.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Omit / `all` / invalid → no cap (return the full list). */
export function parseEntityListLimit(
  raw: string | null | undefined,
): number | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "all") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

export function parseEntityListOffset(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
