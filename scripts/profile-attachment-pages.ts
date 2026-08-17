/**
 * Profile cached PDF attachments into attachment_document_pages.
 *
 * Usage:
 *   npx tsx scripts/profile-attachment-pages.ts
 *   npx tsx scripts/profile-attachment-pages.ts --limit=20
 *   npx tsx scripts/profile-attachment-pages.ts --all
 *   npx tsx scripts/profile-attachment-pages.ts --all --quiet
 *   npx tsx scripts/profile-attachment-pages.ts --hash=<sha256>
 *   npx tsx scripts/profile-attachment-pages.ts --dry-run
 *
 * Without --all, defaults to --limit=50. Prefer docs whose stored
 * profiler_version != current PAGE_PROFILER_VERSION (or have no page rows).
 */

import { readFile } from "fs/promises";
import path from "path";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "../lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
  emailAttachments,
} from "../lib/db/schema";
import { upsertAttachmentDocumentPages } from "../lib/email/attachment-document-pages";
import {
  PAGE_PROFILER_VERSION,
  profilePdfPages,
  summarizeProfiles,
} from "../lib/pdf/page-profile";

function loadEnvLocal() {
  // Match scripts/db-migrate.cjs: allow DATABASE_URL from .env.local
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

async function resolveCachedPdfPath(
  contentHash: string,
  ext: string | null,
): Promise<string | null> {
  const candidates = [
    ext ? path.join(process.cwd(), "data", "email-attachments", `${contentHash}${ext}`) : null,
    path.join(process.cwd(), "data", "email-attachments", `${contentHash}.pdf`),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

async function main() {
  const all = hasFlag("all");
  const quiet = hasFlag("quiet");
  const limitRaw = argValue("limit");
  const limit = all
    ? Number.POSITIVE_INFINITY
    : Number(limitRaw ?? "50");
  const onlyHash = argValue("hash");
  const dryRun = hasFlag("dry-run");

  const db = getDb();

  let targets: Array<{ contentHash: string; ext: string | null }> = [];
  const alreadyCurrentHashes = new Set<string>();

  if (onlyHash) {
    const [doc] = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        ext: attachmentDocuments.ext,
      })
      .from(attachmentDocuments)
      .where(eq(attachmentDocuments.contentHash, onlyHash))
      .limit(1);

    if (doc) {
      targets = [doc];
    } else {
      targets = [{ contentHash: onlyHash, ext: ".pdf" }];
    }
  } else {
    // Union attachment_documents PDFs with distinct cached email_attachments
    // hashes. Previously we short-circuited on any attachment_documents rows and
    // skipped the bulk of the on-disk cache (~2k PDFs vs a handful of docs).
    const docs = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        ext: attachmentDocuments.ext,
      })
      .from(attachmentDocuments)
      .where(
        sql`lower(${attachmentDocuments.mimeType}) like 'application/pdf%'
            or lower(${attachmentDocuments.ext}) = '.pdf'`,
      );

    const rows = await db
      .select({
        contentHash: emailAttachments.contentHash,
        cachedFilePath: emailAttachments.cachedFilePath,
      })
      .from(emailAttachments)
      .where(
        and(
          isNotNull(emailAttachments.contentHash),
          isNotNull(emailAttachments.cachedFilePath),
          sql`lower(${emailAttachments.mimeType}) like 'application/pdf%'`,
        ),
      );

    const byHash = new Map<string, { contentHash: string; ext: string | null }>();
    for (const doc of docs) {
      byHash.set(doc.contentHash, {
        contentHash: doc.contentHash,
        ext: doc.ext,
      });
    }
    for (const row of rows) {
      if (!row.contentHash || byHash.has(row.contentHash)) continue;
      const ext =
        row.cachedFilePath?.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".pdf";
      byHash.set(row.contentHash, { contentHash: row.contentHash, ext });
    }

    const merged = [...byHash.values()];

    // Stale / missing profiler versions first so limited runs refresh usefully.
    const freshness = await db
      .select({
        contentHash: attachmentDocumentPages.contentHash,
        hasStale: sql<number>`max(case when ${attachmentDocumentPages.profilerVersion} <> ${PAGE_PROFILER_VERSION} then 1 else 0 end)::int`,
        hasAny: sql<number>`count(*)::int`,
      })
      .from(attachmentDocumentPages)
      .groupBy(attachmentDocumentPages.contentHash);

    const freshnessByHash = new Map(
      freshness.map((r) => [
        r.contentHash,
        {
          hasCurrent: (r.hasAny ?? 0) > 0 && (r.hasStale ?? 0) === 0,
          hasAny: (r.hasAny ?? 0) > 0,
        },
      ]),
    );

    for (const [hash, f] of freshnessByHash) {
      if (f.hasAny && f.hasCurrent) alreadyCurrentHashes.add(hash);
    }

    merged.sort((a, b) => {
      const fa = freshnessByHash.get(a.contentHash);
      const fb = freshnessByHash.get(b.contentHash);
      const rank = (f?: { hasCurrent: boolean; hasAny: boolean }) => {
        if (!f?.hasAny) return 0;
        if (!f.hasCurrent) return 1;
        return 2;
      };
      const d = rank(fa) - rank(fb);
      if (d !== 0) return d;
      return a.contentHash.localeCompare(b.contentHash);
    });

    targets = all
      ? merged
      : merged.slice(
          0,
          Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50,
        );
  }

  console.info(
    `[profile] start version=${PAGE_PROFILER_VERSION} targets=${targets.length} dryRun=${dryRun} quiet=${quiet}`,
  );

  let profiled = 0;
  let failed = 0;
  let skipped = 0;
  let alreadyCurrent = 0;
  let totalPages = 0;
  let visionPages = 0;
  let ambiguousPages = 0;
  let textPages = 0;
  let processed = 0;

  for (const target of targets) {
    processed += 1;
    // Skip docs already fully on current profiler version unless --hash forced.
    if (!onlyHash && !dryRun && alreadyCurrentHashes.has(target.contentHash)) {
      alreadyCurrent += 1;
      if (!quiet) {
        console.info(
          `[profile] skip current ${target.contentHash.slice(0, 12)}…`,
        );
      } else if (processed % 100 === 0) {
        console.info(
          `[profile] progress ${processed}/${targets.length} profiled=${profiled} skippedCurrent=${alreadyCurrent} failed=${failed}`,
        );
      }
      continue;
    }

    const filePath = await resolveCachedPdfPath(target.contentHash, target.ext);
    if (!filePath) {
      skipped += 1;
      console.warn(`[profile] missing bytes ${target.contentHash}`);
      continue;
    }

    try {
      const bytes = await readFile(filePath);
      const profiles = await profilePdfPages(bytes);
      const summary = summarizeProfiles(profiles);
      totalPages += summary.totalPages;
      textPages += summary.text;
      visionPages += summary.vision;
      ambiguousPages += summary.ambiguous;

      console.info(
        `[profile] ${target.contentHash.slice(0, 12)}… pages=${summary.totalPages} text=${summary.text} vision=${summary.vision} ambiguous=${summary.ambiguous}`,
      );
      if (!quiet) {
        for (const p of profiles) {
          console.info(
            `  page ${p.pageNo}: route=${p.route} chars=${p.chars} hasTextLayer=${p.hasTextLayer} textArea=${p.textAreaRatio} imageArea=${p.imageAreaRatio} vectorOps=${p.vectorOps}`,
          );
        }
      } else if (processed % 25 === 0) {
        console.info(
          `[profile] progress ${processed}/${targets.length} profiled=${profiled + 1} failed=${failed}`,
        );
      }

      if (!dryRun) {
        // Ensure parent row exists so FK succeeds.
        const [existing] = await db
          .select({ contentHash: attachmentDocuments.contentHash })
          .from(attachmentDocuments)
          .where(eq(attachmentDocuments.contentHash, target.contentHash))
          .limit(1);

        if (!existing) {
          await db.insert(attachmentDocuments).values({
            contentHash: target.contentHash,
            mimeType: "application/pdf",
            ext: target.ext ?? ".pdf",
            parseStatus: "pending",
            parseError: null,
            pageCount: profiles.length,
            attempts: 0,
            firstSeenAt: new Date().toISOString(),
          });
        }

        await upsertAttachmentDocumentPages(target.contentHash, profiles);
        alreadyCurrentHashes.add(target.contentHash);
      }
      profiled += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[profile] fail ${target.contentHash}: ${message}`);
    }
  }

  const rate =
    totalPages === 0 ? 0 : (visionPages + ambiguousPages) / totalPages;

  console.info("[profile:complete]", {
    version: PAGE_PROFILER_VERSION,
    targets: targets.length,
    profiled,
    alreadyCurrent,
    failed,
    skipped,
    dryRun,
    totalPages,
    textPages,
    visionPages,
    ambiguousPages,
    visionOrAmbiguousRate: Number(rate.toFixed(4)),
  });
}

main().catch((error) => {
  console.error("[profile:fatal]", error);
  process.exit(1);
});
