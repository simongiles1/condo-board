/**
 * Suggest ~20 golden-set PDF candidates from the attachment cache / DB.
 *
 * Buckets: blueprint/floorplan, scan/stamp, table/financial, contract/text, mixed.
 * Prints JSON lines you can paste into data/golden-attachments/manifest.json.
 *
 * Usage:
 *   npx tsx scripts/list-golden-attachment-candidates.ts
 *   npx tsx scripts/list-golden-attachment-candidates.ts --per-bucket=5
 */

import path from "path";

import { and, desc, isNotNull, sql } from "drizzle-orm";

import { getDb } from "../lib/db";
import { emailAttachments } from "../lib/db/schema";

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

type Bucket =
  | "blueprint"
  | "scan_stamp"
  | "table_financial"
  | "contract_text"
  | "mixed_package";

const BUCKET_PATTERNS: Record<Bucket, RegExp[]> = {
  blueprint: [
    /blueprint/i,
    /floor\s*plan/i,
    /site\s*plan/i,
    /schematic/i,
    /drawing/i,
    /dwg/i,
    /\bas[-_ ]?built\b/i,
    /mechanical/i,
    /electrical\s*plan/i,
  ],
  scan_stamp: [
    /scan(ned)?/i,
    /stamp/i,
    /signed/i,
    /handwrit/i,
    /approval/i,
    /invoice/i,
    /receipt/i,
  ],
  table_financial: [
    /invoice/i,
    /statement/i,
    /budget/i,
    /financial/i,
    /ledger/i,
    /spreadsheet/i,
    /quote/i,
    /estimate/i,
    /bid\b/i,
  ],
  contract_text: [
    /contract/i,
    /agreement/i,
    /lease/i,
    /bylaw/i,
    /policy/i,
    /minutes/i,
    /proposal/i,
  ],
  mixed_package: [
    /board\s*package/i,
    /package/i,
    /agenda/i,
    /bundle/i,
    /meeting\s*pack/i,
  ],
};

function classifyFilename(filename: string): Bucket | null {
  for (const [bucket, patterns] of Object.entries(BUCKET_PATTERNS) as Array<
    [Bucket, RegExp[]]
  >) {
    if (patterns.some((re) => re.test(filename))) return bucket;
  }
  return null;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const perBucket = Math.max(1, Number(argValue("per-bucket") ?? "5") || 5);
  const db = getDb();

  const rows = await db
    .select({
      contentHash: emailAttachments.contentHash,
      filename: emailAttachments.filename,
      pageCount: emailAttachments.pageCount,
      sizeBytes: emailAttachments.sizeBytes,
      cachedFilePath: emailAttachments.cachedFilePath,
      mimeType: emailAttachments.mimeType,
    })
    .from(emailAttachments)
    .where(
      and(
        isNotNull(emailAttachments.contentHash),
        isNotNull(emailAttachments.cachedFilePath),
        sql`lower(${emailAttachments.mimeType}) like 'application/pdf%'`,
        sql`coalesce(${emailAttachments.hasValue}, true) = true`,
      ),
    )
    .orderBy(desc(emailAttachments.pageCount))
    .limit(5_000);

  // Prefer label-friendly sizes; keep mixed_package as long board packs.
  function scoreForBucket(bucket: Bucket, pageCount: number | null): number {
    const pages = pageCount ?? 99;
    if (bucket === "mixed_package") {
      // Want large packages, but not the absolute longest first only.
      if (pages >= 20 && pages <= 80) return 0;
      if (pages > 80) return 1;
      return 3;
    }
    if (pages >= 2 && pages <= 20) return 0;
    if (pages === 1 || (pages > 20 && pages <= 40)) return 1;
    return 2;
  }

  const buckets: Record<Bucket, typeof rows> = {
    blueprint: [],
    scan_stamp: [],
    table_financial: [],
    contract_text: [],
    mixed_package: [],
  };

  const seen = new Set<string>();
  const classified: Array<{ bucket: Bucket; row: (typeof rows)[number] }> = [];

  for (const row of rows) {
    if (!row.contentHash) continue;
    const bucket = classifyFilename(row.filename);
    if (!bucket) continue;
    classified.push({ bucket, row });
  }

  classified.sort(
    (a, b) =>
      scoreForBucket(a.bucket, a.row.pageCount) -
        scoreForBucket(b.bucket, b.row.pageCount) ||
      (a.row.pageCount ?? 0) - (b.row.pageCount ?? 0),
  );

  for (const { bucket, row } of classified) {
    if (!row.contentHash || seen.has(row.contentHash)) continue;
    if (buckets[bucket].length >= perBucket) continue;
    seen.add(row.contentHash);
    buckets[bucket].push(row);
  }

  // Fill remaining slots with large multi-page PDFs (likely board packages).
  if (buckets.mixed_package.length < perBucket) {
    for (const row of rows) {
      if (!row.contentHash || seen.has(row.contentHash)) continue;
      if ((row.pageCount ?? 0) < 10) continue;
      seen.add(row.contentHash);
      buckets.mixed_package.push(row);
      if (buckets.mixed_package.length >= perBucket) break;
    }
  }

  const candidates: Array<{
    id: string;
    bucket: Bucket;
    contentHash: string;
    filename: string;
    pageCount: number | null;
    sizeBytes: number | null;
    cachedFilePath: string | null;
    note: string;
  }> = [];

  let n = 1;
  for (const [bucket, list] of Object.entries(buckets) as Array<
    [Bucket, typeof rows]
  >) {
    for (const row of list) {
      candidates.push({
        id: `g${String(n).padStart(2, "0")}`,
        bucket,
        contentHash: row.contentHash!,
        filename: row.filename,
        pageCount: row.pageCount,
        sizeBytes: row.sizeBytes,
        cachedFilePath: row.cachedFilePath,
        note: "TODO: open PDF, label each page as text|vision|ambiguous",
      });
      n += 1;
    }
  }

  const manifest = {
    version: 1,
    description:
      "Golden set for calibrating PAGE_ROUTE_THRESHOLDS in lib/pdf/page-profile.ts. Label expectedRoute per page after reviewing the PDF. For docs >20 pages, label a representative sample (cover + diagram/scan pages + a few dense text pages), not every page.",
    thresholdsFile: "lib/pdf/page-profile.ts",
    documents: candidates.map((c) => ({
      id: c.id,
      bucket: c.bucket,
      contentHash: c.contentHash,
      filename: c.filename,
      pageCount: c.pageCount,
      pages: [] as Array<{
        pageNo: number;
        expectedRoute: "text" | "vision" | "ambiguous";
        notes?: string;
      }>,
      note: c.note,
    })),
  };

  console.log(JSON.stringify(manifest, null, 2));
  console.error(
    `[candidates] ${candidates.length} docs across buckets:`,
    Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, v.length]),
    ),
  );
  console.error(
    "Next: save to fixtures/golden-attachments/manifest.json, label pages, then run:",
  );
  console.error("  npm run golden:calibrate-page-profile");
}

main().catch((error) => {
  console.error("[candidates:fatal]", error);
  process.exit(1);
});
