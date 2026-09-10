import fs from "fs";
import path from "path";

import { eq } from "drizzle-orm";

import { getDb } from "../lib/db";
import { attachmentDocuments } from "../lib/db/schema";
import { readCachedDoclingMarkdown } from "../lib/email/docling-lab";
import { readAttachmentMarkdown } from "../lib/email/attachment-markdown";

function loadEnvLocal() {
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
}

async function main() {
  loadEnvLocal();
  const hash = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    console.error("Usage: npx tsx scripts/print-attachment-doc-status.ts <contentHash>");
    process.exit(1);
  }
  const db = getDb();
  const [doc] = await db
    .select()
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, hash))
    .limit(1);

  const promotedMd = await readAttachmentMarkdown(hash);
  const doclingCache = await readCachedDoclingMarkdown(hash);

  console.log(
    JSON.stringify(
      {
        row: doc
          ? {
              parseStatus: doc.parseStatus,
              parseError: doc.parseError,
              parserName: doc.parserName,
              markdownChars: doc.markdownChars,
              markdownPath: doc.markdownPath,
            }
          : null,
        promotedMarkdownChars: promotedMd?.length ?? 0,
        doclingCacheChars: doclingCache?.length ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
