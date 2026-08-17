/**
 * Idempotent local Docling backfill for text-route PDF pages only.
 *
 * Uses the Docling sidecar + per-page cache under
 * data/email-attachments/{hash}/docling/pNNN.md. Restart-safe: cached pages
 * are skipped. Vision/ambiguous pages are never converted.
 *
 * Prerequisites:
 *   npm run docling:sidecar
 *
 * Usage:
 *   npx tsx scripts/backfill-docling-text-pages.ts
 *   npx tsx scripts/backfill-docling-text-pages.ts --limit=20
 *   npx tsx scripts/backfill-docling-text-pages.ts --max-pages=100
 *   npx tsx scripts/backfill-docling-text-pages.ts --all
 *   npx tsx scripts/backfill-docling-text-pages.ts --hash=<sha256>
 *   npx tsx scripts/backfill-docling-text-pages.ts --dry-run
 *   npx tsx scripts/backfill-docling-text-pages.ts --force
 *
 * Without --all, defaults to --limit=50 documents that still have pending
 * uncached text pages (and a PDF on disk).
 */

import path from "path";

import {
  checkDoclingSidecarHealth,
  convertWithDoclingSidecar,
  listDoclingBackfillDocs,
} from "../lib/email/docling-lab";

function loadEnvLocal() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const force = hasFlag("force");
  const all = hasFlag("all");
  const quiet = hasFlag("quiet");
  const onlyHash = argValue("hash")?.trim().toLowerCase();
  const limitRaw = argValue("limit");
  const maxPagesRaw = argValue("max-pages");

  const docLimit = all ? Number.POSITIVE_INFINITY : Number(limitRaw ?? "50");
  const maxPages = maxPagesRaw
    ? Number(maxPagesRaw)
    : Number.POSITIVE_INFINITY;

  if (
    !all &&
    (!Number.isFinite(docLimit) || docLimit < 1)
  ) {
    console.error("[docling-backfill] invalid --limit");
    process.exit(1);
  }
  if (
    maxPagesRaw !== undefined &&
    (!Number.isFinite(maxPages) || maxPages < 1)
  ) {
    console.error("[docling-backfill] invalid --max-pages");
    process.exit(1);
  }

  console.log(
    `[docling-backfill] scanning text-route pages` +
      (onlyHash ? ` hash=${onlyHash.slice(0, 12)}…` : "") +
      (dryRun ? " dry-run" : "") +
      (force ? " force" : "") +
      ` docLimit=${all ? "∞" : docLimit}` +
      ` maxPages=${Number.isFinite(maxPages) ? maxPages : "∞"}`,
  );

  const docs = await listDoclingBackfillDocs(
    onlyHash ? { contentHash: onlyHash } : undefined,
  );

  const totalTextPages = docs.reduce((n, d) => n + d.textPageCount, 0);
  const totalUncached = docs.reduce((n, d) => n + d.uncachedPages.length, 0);
  const missingPdf = docs.filter(
    (d) => d.uncachedPages.length > 0 && !d.hasPdf,
  ).length;
  const pendingDocs = docs.filter((d) => {
    if (!d.hasPdf || d.textPageCount === 0) return false;
    return force || d.uncachedPages.length > 0;
  });

  // Prefer docs with uncached pages even under --force (stable restart order).
  pendingDocs.sort((a, b) => {
    const pa = a.uncachedPages.length > 0 ? 0 : 1;
    const pb = b.uncachedPages.length > 0 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.contentHash.localeCompare(b.contentHash);
  });

  const backlogPages = force ? totalTextPages : totalUncached;

  console.log(
    `[docling-backfill] corpus docs=${docs.length} textPages=${totalTextPages}` +
      ` uncached=${totalUncached}` +
      (force ? ` forceTarget=${totalTextPages}` : "") +
      ` pendingDocs=${pendingDocs.length}` +
      (missingPdf ? ` missingPdf=${missingPdf}` : ""),
  );

  if (!dryRun) {
    const health = await checkDoclingSidecarHealth();
    if (!health.ok) {
      console.error(
        `[docling-backfill] sidecar not reachable at ${health.sidecarUrl}.` +
          ` Run \`npm run docling:sidecar\` first.` +
          (health.detail ? ` (${health.detail})` : ""),
      );
      process.exit(1);
    }
    console.log(`[docling-backfill] sidecar ok at ${health.sidecarUrl}`);
  }

  let docsOk = 0;
  let docsFailed = 0;
  let docsSkipped = 0;
  let pagesNew = 0;
  let pagesCachedHit = 0;
  let pagesFailed = 0;
  let pagesAttempted = 0;
  const startedAt = Date.now();
  let pageBudget = maxPages;
  let docsAttempted = 0;

  for (const doc of pendingDocs) {
    if (docsAttempted >= docLimit || pageBudget <= 0) break;

    const candidatePages = force ? doc.textPages : doc.uncachedPages;
    const pagesToRequest = candidatePages.slice(0, pageBudget);
    if (pagesToRequest.length === 0) {
      docsSkipped += 1;
      continue;
    }

    docsAttempted += 1;
    const short = doc.contentHash.slice(0, 12);

    if (dryRun) {
      console.log(
        `  ○ ${short}… would convert ${pagesToRequest.length}/${doc.textPageCount} text pages` +
          (force ? " (force)" : ""),
      );
      pagesAttempted += pagesToRequest.length;
      pagesNew += pagesToRequest.length;
      pageBudget -= pagesToRequest.length;
      docsOk += 1;
      continue;
    }

    try {
      const result = await convertWithDoclingSidecar({
        contentHash: doc.contentHash,
        pages: pagesToRequest,
        force,
      });

      const converted = result.pages.filter((p) => !p.cached).length;
      const cached = result.pages.filter((p) => p.cached).length;
      pagesNew += converted;
      pagesCachedHit += cached;
      pagesAttempted += pagesToRequest.length;
      pageBudget -= pagesToRequest.length;
      docsOk += 1;

      if (!quiet) {
        const elapsed = Date.now() - startedAt;
        const rate =
          pagesAttempted > 0 ? elapsed / pagesAttempted : Number.NaN;
        const remainingPages = Math.max(0, backlogPages - pagesAttempted);
        const etaMs = Number.isFinite(rate)
          ? remainingPages * rate
          : Number.NaN;
        console.log(
          `  ✓ ${short}… pages=${result.pageCount}` +
            ` new=${converted} cached=${cached}` +
            ` sidecar=${formatDuration(result.elapsedMs)}` +
            ` elapsed=${formatDuration(elapsed)}` +
            (Number.isFinite(etaMs) ? ` eta~${formatDuration(etaMs)}` : ""),
        );
      }
    } catch (error) {
      docsFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${short}… ${message}`);
      pagesFailed += pagesToRequest.length;
      // Partial per-page writes remain on disk — safe to restart.
    }
  }

  if (missingPdf > 0 && !quiet) {
    console.log(
      `[docling-backfill] skipped ${missingPdf} doc(s) with uncached text pages but no PDF on disk`,
    );
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[docling-backfill] summary` +
      ` docsOk=${docsOk} docsFailed=${docsFailed} docsSkipped=${docsSkipped}` +
      ` pagesNew=${pagesNew} pagesCachedHit=${pagesCachedHit}` +
      ` pagesFailed=${pagesFailed}` +
      ` elapsed=${formatDuration(elapsedMs)}` +
      (dryRun ? " (dry-run)" : ""),
  );

  // Rate from newly converted pages only (cache hits don't measure CPU work).
  if (!dryRun && pagesNew > 0 && elapsedMs > 0) {
    const secPerPage = elapsedMs / 1000 / pagesNew;
    const pagesPerHour = 3600 / secPerPage;
    const remainingUncached = Math.max(0, totalUncached - pagesNew);
    const corpusEtaMs = remainingUncached * (elapsedMs / pagesNew);
    console.log(
      `[docling-backfill] rate` +
        ` ${secPerPage.toFixed(2)}s/page` +
        ` (${pagesPerHour.toFixed(0)} pages/h)` +
        ` from ${pagesNew} new pages across ${docsOk} doc(s)`,
    );
    console.log(
      `[docling-backfill] extrapolate` +
        ` uncachedRemaining=${remainingUncached}` +
        ` corpusEta~${formatDuration(corpusEtaMs)}` +
        ` (at this sample rate; excludes already-cached)`,
    );
  }

  if (docsFailed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[docling-backfill] fatal:", error);
  process.exit(1);
});
