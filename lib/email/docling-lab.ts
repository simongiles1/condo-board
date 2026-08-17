/**
 * Extraction Lab: call local Docling sidecar and cache markdown next to the PDF.
 * Lab-only — does not change Cloudflare / Gemini production paths.
 *
 * Mixed docs: convert `route=text` pages only; vision/ambiguous stay on Gemini.
 */

import { readdir } from "fs/promises";
import path from "path";

import { sql } from "drizzle-orm";

import { resolveCachedPdfAbsolutePath } from "@/lib/dev/golden-attachments";
import { getDb } from "@/lib/db";
import { convertPagesWithIbmDocling, checkIbmDoclingHealth } from "@/lib/email/docling-ibm";
import {
  type DoclingProvider,
  normalizeDoclingProvider,
} from "@/lib/email/docling-provider";
import {
  readExtractArtifactText,
  writeExtractArtifactText,
} from "@/lib/storage/extract-artifacts";

const HASH_RE = /^[a-f0-9]{64}$/i;

export function doclingMarkerOpen(pageNo: number): string {
  return `<!-- docling:page=${pageNo} -->`;
}

export function doclingMarkerClose(pageNo: number): string {
  return `<!-- /docling:page=${pageNo} -->`;
}

export function formatDoclingPageBlock(pageNo: number, body: string): string {
  const trimmed = body.trim();
  return [
    doclingMarkerOpen(pageNo),
    trimmed,
    doclingMarkerClose(pageNo),
  ].join("\n");
}

/** Collapse 1-based page numbers into inclusive [start, end] ranges. */
export function collapsePageRanges(pages: number[]): Array<[number, number]> {
  const unique = [
    ...new Set(
      pages
        .map((p) => Math.floor(Number(p)))
        .filter((p) => Number.isFinite(p) && p >= 1),
    ),
  ].sort((a, b) => a - b);
  if (unique.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = unique[0]!;
  let prev = unique[0]!;
  for (let i = 1; i < unique.length; i += 1) {
    const page = unique[i]!;
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    ranges.push([start, prev]);
    start = page;
    prev = page;
  }
  ranges.push([start, prev]);
  return ranges;
}

export function extractDoclingPageMarkdown(
  markdown: string | null | undefined,
  pageNo: number,
): string | null {
  if (!markdown?.trim() || !Number.isInteger(pageNo) || pageNo < 1) return null;
  const open = doclingMarkerOpen(pageNo);
  const close = doclingMarkerClose(pageNo);
  const start = markdown.indexOf(open);
  if (start < 0) return null;
  const end = markdown.indexOf(close, start);
  if (end < 0) return null;
  return markdown.slice(start + open.length, end).trim() || null;
}

/** Page numbers with a non-empty Docling marker block in assembled markdown. */
export function listDoclingMarkerPageNos(
  markdown: string | null | undefined,
): number[] {
  if (!markdown?.trim()) return [];
  const pages: number[] = [];
  const re =
    /<!-- docling:page=(\d+) -->\s*([\s\S]*?)<!-- \/docling:page=\1 -->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const pageNo = Number(match[1]);
    if (!Number.isInteger(pageNo) || pageNo < 1) continue;
    if (!match[2].trim()) continue;
    pages.push(pageNo);
  }
  return pages;
}

export type DoclingCacheCoverage = {
  textRouteDocs: number;
  textRoutePages: number;
  cachedDoclingPages: number;
  uncachedDoclingPages: number;
  pendingDoclingDocs: number;
  doneDoclingDocs: number;
};

export function tallyDoclingCacheCoverage(
  textPagesByHash: Map<string, number[]>,
  cachedPagesByHash: Map<string, ReadonlySet<number>>,
): DoclingCacheCoverage {
  let cachedPages = 0;
  let uncachedPages = 0;
  let pendingDocs = 0;
  let doneDocs = 0;
  for (const [contentHash, pages] of textPagesByHash) {
    if (pages.length === 0) continue;
    const cached = cachedPagesByHash.get(contentHash);
    let uncached = 0;
    for (const pageNo of pages) {
      if (cached?.has(pageNo)) cachedPages += 1;
      else uncached += 1;
    }
    uncachedPages += uncached;
    if (uncached > 0) pendingDocs += 1;
    else doneDocs += 1;
  }
  return {
    textRouteDocs: textPagesByHash.size,
    textRoutePages: cachedPages + uncachedPages,
    cachedDoclingPages: cachedPages,
    uncachedDoclingPages: uncachedPages,
    pendingDoclingDocs: pendingDocs,
    doneDoclingDocs: doneDocs,
  };
}

export function assembleDoclingMarkdown(
  pages: Array<{ pageNo: number; markdown: string }>,
): string {
  return pages
    .filter((p) => p.markdown.trim())
    .sort((a, b) => a.pageNo - b.pageNo)
    .map((p) => formatDoclingPageBlock(p.pageNo, p.markdown))
    .join("\n\n")
    .trim();
}

export function doclingCacheRelativeKey(contentHash: string): string {
  return path.posix.join(
    "data",
    "email-attachments",
    `${contentHash.toLowerCase()}.docling.md`,
  );
}

export function doclingCacheAbsolutePath(contentHash: string): string {
  return path.join(
    process.cwd(),
    "data",
    "email-attachments",
    `${contentHash.toLowerCase()}.docling.md`,
  );
}

export function doclingPageCacheAbsolutePath(
  contentHash: string,
  pageNo: number,
): string {
  const padded = String(pageNo).padStart(3, "0");
  return path.join(
    process.cwd(),
    "data",
    "email-attachments",
    contentHash.toLowerCase(),
    "docling",
    `p${padded}.md`,
  );
}

export function getDoclingSidecarBaseUrl(): string {
  return (
    process.env.DOCLING_SIDECAR_URL?.trim().replace(/\/$/, "") ||
    "http://127.0.0.1:5001"
  );
}

export type DoclingPageResult = {
  pageNo: number;
  markdown: string;
  cached: boolean;
};

export type DoclingConvertResult = {
  contentHash: string;
  markdown: string;
  pages: DoclingPageResult[];
  requestedPages: number[];
  skippedPages: number[];
  elapsedMs: number;
  pageCount: number;
  cached: boolean;
  sidecarUrl: string;
  provider: DoclingProvider;
  costUsd: number;
};

export async function readCachedDoclingMarkdown(
  contentHash: string,
): Promise<string | null> {
  return readExtractArtifactText(doclingCacheAbsolutePath(contentHash));
}

export async function writeCachedDoclingMarkdown(
  contentHash: string,
  markdown: string,
): Promise<void> {
  await writeExtractArtifactText(
    doclingCacheAbsolutePath(contentHash),
    markdown,
  );
}

export async function readCachedDoclingPage(
  contentHash: string,
  pageNo: number,
): Promise<string | null> {
  const body = await readExtractArtifactText(
    doclingPageCacheAbsolutePath(contentHash, pageNo),
  );
  const trimmed = body?.trim();
  return trimmed || null;
}

export async function hasCachedDoclingPage(
  contentHash: string,
  pageNo: number,
  assembledMarkdown?: string | null,
): Promise<boolean> {
  const cached = await readCachedDoclingPage(contentHash, pageNo);
  if (cached) return true;
  // Older whole-doc runs: treat assembled markers as cached (hydrate on convert).
  const assembled =
    assembledMarkdown === undefined
      ? await readCachedDoclingMarkdown(contentHash)
      : assembledMarkdown;
  return Boolean(extractDoclingPageMarkdown(assembled, pageNo));
}

/**
 * Text-route pages for a hash that lack per-page (or assembled-marker) cache.
 * Restart-safe backlog unit for local Docling backfill.
 */
export async function listUncachedTextRoutePages(
  contentHash: string,
): Promise<number[]> {
  const textPages = await listTextRoutePageNos(contentHash);
  const assembled = await readCachedDoclingMarkdown(contentHash);
  const uncached: number[] = [];
  for (const pageNo of textPages) {
    if (!(await hasCachedDoclingPage(contentHash, pageNo, assembled))) {
      uncached.push(pageNo);
    }
  }
  return uncached;
}

export type DoclingBackfillDoc = {
  contentHash: string;
  textPages: number[];
  textPageCount: number;
  uncachedPages: number[];
  hasPdf: boolean;
};

/**
 * Docs with `route=text` pages, optionally filtered to a single hash.
 * Includes fully-cached docs (uncachedPages=[]) so callers can report totals.
 */
export async function listDoclingBackfillDocs(options?: {
  contentHash?: string;
}): Promise<DoclingBackfillDoc[]> {
  const onlyHash = options?.contentHash?.trim().toLowerCase();
  if (onlyHash && !HASH_RE.test(onlyHash)) {
    throw new Error("contentHash must be a 64-char hex digest.");
  }

  const db = getDb();
  const rows = onlyHash
    ? await db.execute<{ content_hash: string; page_no: number }>(sql`
        select content_hash, page_no
        from attachment_document_pages
        where content_hash = ${onlyHash}
          and route = 'text'
        order by page_no
      `)
    : await db.execute<{ content_hash: string; page_no: number }>(sql`
        select content_hash, page_no
        from attachment_document_pages
        where route = 'text'
        order by content_hash, page_no
      `);

  const byHash = new Map<string, number[]>();
  for (const row of rows.rows ?? []) {
    const hash = String(row.content_hash).toLowerCase();
    const pageNo = Number(row.page_no);
    if (!HASH_RE.test(hash) || !Number.isInteger(pageNo) || pageNo < 1) continue;
    const list = byHash.get(hash) ?? [];
    list.push(pageNo);
    byHash.set(hash, list);
  }

  const docs: DoclingBackfillDoc[] = [];
  for (const [contentHash, textPages] of byHash) {
    const uniquePages = normalizePageList(textPages);
    const assembled = await readCachedDoclingMarkdown(contentHash);
    const uncachedPages: number[] = [];
    for (const pageNo of uniquePages) {
      if (!(await hasCachedDoclingPage(contentHash, pageNo, assembled))) {
        uncachedPages.push(pageNo);
      }
    }
    const pdfPath = await resolveCachedPdfAbsolutePath(contentHash);
    docs.push({
      contentHash,
      textPages: uniquePages,
      textPageCount: uniquePages.length,
      uncachedPages,
      hasPdf: Boolean(pdfPath),
    });
  }

  // Pending work first, then hash order for stable restarts.
  docs.sort((a, b) => {
    const pa = a.uncachedPages.length > 0 && a.hasPdf ? 0 : 1;
    const pb = b.uncachedPages.length > 0 && b.hasPdf ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.contentHash.localeCompare(b.contentHash);
  });

  return docs;
}

const PAGE_CACHE_FILE_RE = /^p(\d+)\.md$/i;

function addCachedPage(
  cached: Map<string, Set<number>>,
  contentHash: string,
  pageNo: number,
) {
  let pages = cached.get(contentHash);
  if (!pages) {
    pages = new Set();
    cached.set(contentHash, pages);
  }
  pages.add(pageNo);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  }
  const pool = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: pool }, () => run()));
}

/** Per-page `pNNN.md` files under each hash's docling cache dir. */
async function loadCachedDoclingPageFiles(): Promise<Map<string, Set<number>>> {
  const cached = new Map<string, Set<number>>();
  const root = path.join(process.cwd(), "data", "email-attachments");
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return cached;
  }

  const hashDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hash = entry.name.toLowerCase();
    if (!HASH_RE.test(hash)) continue;
    hashDirs.push(hash);
  }

  await mapPool(hashDirs, 32, async (hash) => {
    let files: string[];
    try {
      files = await readdir(path.join(root, hash, "docling"));
    } catch {
      return;
    }
    for (const file of files) {
      const match = PAGE_CACHE_FILE_RE.exec(file);
      if (!match) continue;
      const pageNo = Number(match[1]);
      if (!Number.isInteger(pageNo) || pageNo < 1) continue;
      addCachedPage(cached, hash, pageNo);
    }
  });

  return cached;
}

async function mergeAssembledDoclingCache(
  textPagesByHash: Map<string, number[]>,
  cached: Map<string, Set<number>>,
): Promise<void> {
  const hashes: string[] = [];
  for (const [hash, pages] of textPagesByHash) {
    const have = cached.get(hash);
    const missing = have
      ? pages.some((pageNo) => !have.has(pageNo))
      : pages.length > 0;
    if (missing) hashes.push(hash);
  }

  await mapPool(hashes, 16, async (hash) => {
    const markdown = await readCachedDoclingMarkdown(hash);
    if (!markdown?.trim()) return;
    for (const pageNo of listDoclingMarkerPageNos(markdown)) {
      addCachedPage(cached, hash, pageNo);
    }
  });
}

/**
 * Corpus totals plus cache coverage for the Extraction lab modal.
 * Page-file listing + leftover assembled-markdown reads — not a per-page
 * exists() walk of the whole text-route set.
 */
export async function summarizeDoclingBackfillCorpus(): Promise<DoclingCacheCoverage> {
  const db = getDb();
  const rows = await db.execute<{ content_hash: string; page_no: number }>(sql`
    select content_hash, page_no
    from attachment_document_pages
    where route = 'text'
  `);

  const textPagesByHash = new Map<string, number[]>();
  for (const row of rows.rows ?? []) {
    const hash = String(row.content_hash).toLowerCase();
    const pageNo = Number(row.page_no);
    if (!HASH_RE.test(hash) || !Number.isInteger(pageNo) || pageNo < 1) continue;
    const list = textPagesByHash.get(hash) ?? [];
    list.push(pageNo);
    textPagesByHash.set(hash, list);
  }

  const cached = await loadCachedDoclingPageFiles();
  await mergeAssembledDoclingCache(textPagesByHash, cached);
  return tallyDoclingCacheCoverage(textPagesByHash, cached);
}

/**
 * Full pending scan (cache + PDF). Use when starting a run or reporting
 * precise uncached counts — can take tens of seconds on a large corpus.
 */
export async function scanDoclingBackfillPending(): Promise<{
  pendingDocs: DoclingBackfillDoc[];
  uncachedPages: number;
  missingPdfDocs: number;
}> {
  const docs = await listDoclingBackfillDocs();
  const pendingDocs = docs.filter(
    (d) => d.hasPdf && d.uncachedPages.length > 0,
  );
  const uncachedPages = pendingDocs.reduce(
    (n, d) => n + d.uncachedPages.length,
    0,
  );
  const missingPdfDocs = docs.filter(
    (d) => !d.hasPdf && d.uncachedPages.length > 0,
  ).length;
  return { pendingDocs, uncachedPages, missingPdfDocs };
}

async function writeCachedDoclingPage(
  contentHash: string,
  pageNo: number,
  markdown: string,
): Promise<void> {
  await writeExtractArtifactText(
    doclingPageCacheAbsolutePath(contentHash, pageNo),
    `${markdown.trim()}\n`,
  );
}

/** Text-route pages for a document (1-based). Empty if unprofiled / none. */
export async function listTextRoutePageNos(
  contentHash: string,
): Promise<number[]> {
  const hash = contentHash.trim().toLowerCase();
  if (!HASH_RE.test(hash)) return [];
  const db = getDb();
  const rows = await db.execute<{ page_no: number }>(sql`
    select page_no
    from attachment_document_pages
    where content_hash = ${hash}
      and route = 'text'
    order by page_no
  `);
  return (rows.rows ?? [])
    .map((r) => Number(r.page_no))
    .filter((n) => Number.isInteger(n) && n >= 1);
}

/** Non-text profiled pages (vision / ambiguous) — Docling should skip these. */
export async function listNonTextRoutePageNos(
  contentHash: string,
): Promise<number[]> {
  const hash = contentHash.trim().toLowerCase();
  if (!HASH_RE.test(hash)) return [];
  const db = getDb();
  const rows = await db.execute<{ page_no: number }>(sql`
    select page_no
    from attachment_document_pages
    where content_hash = ${hash}
      and route in ('vision', 'ambiguous')
    order by page_no
  `);
  return (rows.rows ?? [])
    .map((r) => Number(r.page_no))
    .filter((n) => Number.isInteger(n) && n >= 1);
}

type SidecarPage = {
  page_no?: number;
  markdown?: string;
};

type SidecarConvertResponse = {
  content_hash?: string;
  markdown?: string;
  pages?: SidecarPage[];
  elapsed_ms?: number;
  page_count?: number | null;
  requested_pages?: number[] | null;
  detail?: string;
};

function normalizePageList(pages: number[]): number[] {
  return [
    ...new Set(
      pages
        .map((p) => Math.floor(Number(p)))
        .filter((p) => Number.isFinite(p) && p >= 1),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Convert selected PDF pages via the local sidecar or IBM Docling API.
 * Defaults to DB `route=text` pages when `pages` omitted.
 * Uses per-page cache unless `force` is true.
 */
export async function convertDoclingPages(options: {
  contentHash: string;
  pages?: number[];
  force?: boolean;
  provider?: DoclingProvider;
}): Promise<DoclingConvertResult> {
  const contentHash = options.contentHash.trim().toLowerCase();
  if (!HASH_RE.test(contentHash)) {
    throw new Error("contentHash must be a 64-char hex digest.");
  }

  const provider = normalizeDoclingProvider(options.provider);
  const sidecarUrl = getDoclingSidecarBaseUrl();
  const skippedPages = await listNonTextRoutePageNos(contentHash);

  let requestedPages = options.pages
    ? normalizePageList(options.pages)
    : await listTextRoutePageNos(contentHash);

  // Never Docling vision/ambiguous pages even if caller passes them.
  if (skippedPages.length > 0) {
    const skip = new Set(skippedPages);
    requestedPages = requestedPages.filter((p) => !skip.has(p));
  }

  if (requestedPages.length === 0) {
    throw new Error(
      "No text-route pages to convert with Docling (vision/ambiguous-only or unprofiled).",
    );
  }

  const pageResults: DoclingPageResult[] = [];
  const missing: number[] = [];

  for (const pageNo of requestedPages) {
    if (!options.force) {
      const cached = await readCachedDoclingPage(contentHash, pageNo);
      if (cached) {
        pageResults.push({ pageNo, markdown: cached, cached: true });
        continue;
      }
      // Fall back to assembled file markers from older whole-doc runs.
      const assembled = await readCachedDoclingMarkdown(contentHash);
      const fromAssembled = extractDoclingPageMarkdown(assembled, pageNo);
      if (fromAssembled) {
        await writeCachedDoclingPage(contentHash, pageNo, fromAssembled);
        pageResults.push({
          pageNo,
          markdown: fromAssembled,
          cached: true,
        });
        continue;
      }
    }
    missing.push(pageNo);
  }

  let convertElapsedMs = 0;
  let ranConvert = false;
  let costUsd = 0;

  if (missing.length > 0) {
    const pdfPath = await resolveCachedPdfAbsolutePath(contentHash);
    if (!pdfPath) {
      throw new Error(
        "Cached PDF not found under data/email-attachments. Download the attachment first.",
      );
    }

    ranConvert = true;
    const converted = new Map<number, string>();

    if (provider === "ibm") {
      const ibm = await convertPagesWithIbmDocling({
        pdfPath,
        pages: missing,
        filename: `${contentHash}.pdf`,
      });
      convertElapsedMs = ibm.elapsedMs;
      costUsd = ibm.costUsd;
      for (const page of ibm.pages) {
        const body = page.markdown.trim() || "<!-- empty -->";
        converted.set(page.pageNo, body);
        await writeCachedDoclingPage(contentHash, page.pageNo, body);
      }
    } else {
      let response: Response;
      try {
        response = await fetch(`${sidecarUrl}/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content_hash: contentHash,
            pages: missing,
          }),
          signal: AbortSignal.timeout(300_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Docling sidecar unreachable at ${sidecarUrl}. ` +
            `Start it with \`npm run docling:sidecar\` (${message}).`,
        );
      }

      const data = (await response.json().catch(() => ({}))) as SidecarConvertResponse;
      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : `Docling sidecar returned ${response.status}.`;
        throw new Error(detail);
      }

      convertElapsedMs = Number(data.elapsed_ms) || 0;

      for (const page of data.pages ?? []) {
        const pageNo = Number(page.page_no);
        const markdown = page.markdown?.trim() ?? "";
        if (!Number.isInteger(pageNo) || pageNo < 1 || !markdown) continue;
        converted.set(pageNo, markdown);
        await writeCachedDoclingPage(contentHash, pageNo, markdown);
      }

      // Older sidecars may only return assembled markdown with markers.
      if (converted.size === 0 && data.markdown?.trim()) {
        for (const pageNo of missing) {
          const body = extractDoclingPageMarkdown(data.markdown, pageNo);
          if (body) {
            converted.set(pageNo, body);
            await writeCachedDoclingPage(contentHash, pageNo, body);
          }
        }
      }
    }

    for (const pageNo of missing) {
      const markdown = converted.get(pageNo);
      if (!markdown) {
        throw new Error(
          `${provider === "ibm" ? "IBM Docling" : "Docling sidecar"} omitted page ${pageNo}.`,
        );
      }
      pageResults.push({ pageNo, markdown, cached: false });
    }
  }

  pageResults.sort((a, b) => a.pageNo - b.pageNo);
  const markdown = assembleDoclingMarkdown(pageResults);
  await writeCachedDoclingMarkdown(contentHash, `${markdown}\n`);

  const allCached = pageResults.every((p) => p.cached) && !ranConvert;

  return {
    contentHash,
    markdown,
    pages: pageResults,
    requestedPages,
    skippedPages,
    elapsedMs: convertElapsedMs,
    pageCount: pageResults.length,
    cached: allCached,
    sidecarUrl,
    provider,
    costUsd,
  };
}

export async function convertWithDoclingSidecar(options: {
  contentHash: string;
  pages?: number[];
  force?: boolean;
}): Promise<DoclingConvertResult> {
  return convertDoclingPages({ ...options, provider: "sidecar" });
}

export async function readDoclingLabState(contentHash: string): Promise<{
  contentHash: string;
  markdown: string | null;
  pages: DoclingPageResult[];
  cached: boolean;
} | null> {
  const hash = contentHash.trim().toLowerCase();
  const assembled = await readCachedDoclingMarkdown(hash);
  if (!assembled?.trim()) return null;

  const textPages = await listTextRoutePageNos(hash);
  const pageNos =
    textPages.length > 0
      ? textPages
      : [...assembled.matchAll(/<!-- docling:page=(\d+) -->/g)].map((m) =>
          Number(m[1]),
        );

  const pages: DoclingPageResult[] = [];
  for (const pageNo of normalizePageList(pageNos)) {
    const fromFile = await readCachedDoclingPage(hash, pageNo);
    const markdown =
      fromFile ?? extractDoclingPageMarkdown(assembled, pageNo) ?? "";
    if (!markdown) continue;
    pages.push({ pageNo, markdown, cached: true });
  }

  return {
    contentHash: hash,
    markdown: assembled,
    pages,
    cached: true,
  };
}

export async function checkDoclingSidecarHealth(): Promise<{
  ok: boolean;
  sidecarUrl: string;
  detail?: string;
}> {
  const sidecarUrl = getDoclingSidecarBaseUrl();
  try {
    const response = await fetch(`${sidecarUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        sidecarUrl,
        detail: `Health check returned ${response.status}.`,
      };
    }
    return { ok: true, sidecarUrl };
  } catch (error) {
    return {
      ok: false,
      sidecarUrl,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkDoclingProviderHealth(
  provider: DoclingProvider,
): Promise<{
  ok: boolean;
  provider: DoclingProvider;
  url: string;
  detail?: string;
}> {
  if (provider === "ibm") {
    const ibm = await checkIbmDoclingHealth();
    return {
      ok: ibm.ok,
      provider,
      url: ibm.url ?? "",
      detail: ibm.detail,
    };
  }
  const sidecar = await checkDoclingSidecarHealth();
  return {
    ok: sidecar.ok,
    provider,
    url: sidecar.sidecarUrl,
    detail: sidecar.detail,
  };
}
