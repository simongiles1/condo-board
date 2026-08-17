/**
 * Enroll cached image attachments into attachment_documents +
 * attachment_document_pages for page vision.
 *
 * Usage:
 *   npx tsx scripts/enroll-image-attachments.ts
 *   npx tsx scripts/enroll-image-attachments.ts --limit=20
 *   npx tsx scripts/enroll-image-attachments.ts --all
 *   npx tsx scripts/enroll-image-attachments.ts --hash=<sha256>
 *   npx tsx scripts/enroll-image-attachments.ts --dry-run
 */

import path from "path";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "../lib/db";
import {
  attachmentDocuments,
  emailAttachments,
} from "../lib/db/schema";
import { extensionFromCachedPath } from "../lib/email/attachment-markdown-shared";
import { enrollImageAttachmentForVision } from "../lib/email/attachment-vision-image";
import {
  isVisionImageExt,
  isVisionImageMime,
  visionImageMimeFromExt,
} from "../lib/email/attachment-vision-image-shared";

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

type Target = {
  contentHash: string;
  mimeType: string;
  ext: string;
};

async function main() {
  const all = hasFlag("all");
  const dryRun = hasFlag("dry-run");
  const limitRaw = argValue("limit");
  const limit = all ? Number.POSITIVE_INFINITY : Number(limitRaw ?? "50");
  const onlyHash = argValue("hash");

  const db = getDb();
  const targets: Target[] = [];
  const seen = new Set<string>();

  function pushTarget(row: {
    contentHash: string | null;
    mimeType: string;
    cachedFilePath: string | null;
    ext?: string | null;
  }) {
    if (!row.contentHash || seen.has(row.contentHash)) return;
    const ext =
      row.ext ||
      (row.cachedFilePath
        ? extensionFromCachedPath(row.cachedFilePath)
        : ".bin");
    if (!isVisionImageMime(row.mimeType) && !isVisionImageExt(ext)) return;
    seen.add(row.contentHash);
    targets.push({
      contentHash: row.contentHash,
      mimeType:
        (isVisionImageMime(row.mimeType)
          ? row.mimeType
          : visionImageMimeFromExt(ext)) ?? row.mimeType,
      ext,
    });
  }

  if (onlyHash) {
    const [doc] = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        mimeType: attachmentDocuments.mimeType,
        ext: attachmentDocuments.ext,
      })
      .from(attachmentDocuments)
      .where(eq(attachmentDocuments.contentHash, onlyHash))
      .limit(1);

    if (doc) {
      pushTarget({
        contentHash: doc.contentHash,
        mimeType: doc.mimeType,
        cachedFilePath: null,
        ext: doc.ext,
      });
    }

    const attachments = await db
      .select({
        contentHash: emailAttachments.contentHash,
        mimeType: emailAttachments.mimeType,
        cachedFilePath: emailAttachments.cachedFilePath,
      })
      .from(emailAttachments)
      .where(eq(emailAttachments.contentHash, onlyHash))
      .limit(20);

    for (const row of attachments) {
      pushTarget(row);
    }

    if (targets.length === 0) {
      console.error(`No image attachment found for hash ${onlyHash}`);
      process.exitCode = 1;
      return;
    }
  } else {
    const docs = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        mimeType: attachmentDocuments.mimeType,
        ext: attachmentDocuments.ext,
      })
      .from(attachmentDocuments)
      .where(
        sql`lower(${attachmentDocuments.mimeType}) like 'image/%'
            or lower(${attachmentDocuments.ext}) in ('.png', '.jpg', '.jpeg', '.gif', '.webp')`,
      );

    for (const doc of docs) {
      pushTarget({
        contentHash: doc.contentHash,
        mimeType: doc.mimeType,
        cachedFilePath: null,
        ext: doc.ext,
      });
    }

    const rows = await db
      .select({
        contentHash: emailAttachments.contentHash,
        mimeType: emailAttachments.mimeType,
        cachedFilePath: emailAttachments.cachedFilePath,
      })
      .from(emailAttachments)
      .where(
        and(
          isNotNull(emailAttachments.contentHash),
          isNotNull(emailAttachments.cachedFilePath),
          sql`lower(${emailAttachments.mimeType}) like 'image/%'`,
        ),
      );

    for (const row of rows) {
      pushTarget(row);
    }
  }

  const slice = Number.isFinite(limit)
    ? targets.slice(0, Math.max(0, limit))
    : targets;

  console.log(
    `Image vision enroll: ${slice.length} target(s)${dryRun ? " (dry-run)" : ""}`,
  );

  let enrolled = 0;
  let already = 0;
  let skipped = 0;

  for (const target of slice) {
    if (dryRun) {
      console.log(
        `[dry-run] ${target.contentHash.slice(0, 12)}… ${target.mimeType} ${target.ext}`,
      );
      continue;
    }

    const result = await enrollImageAttachmentForVision({
      contentHash: target.contentHash,
      mimeType: target.mimeType,
      ext: target.ext,
    });

    if (result === "enrolled") enrolled += 1;
    else if (result === "already") already += 1;
    else skipped += 1;

    console.log(
      `${result.padEnd(8)} ${target.contentHash.slice(0, 12)}… ${target.mimeType} ${target.ext}`,
    );
  }

  if (!dryRun) {
    console.log(
      `Done. enrolled=${enrolled} already=${already} skipped=${skipped}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
