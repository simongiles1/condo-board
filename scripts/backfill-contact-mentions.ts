/**
 * Convert sparse first-name people into contact_mentions, then resolve.
 *
 * Dry run:
 *   npx tsx scripts/backfill-contact-mentions.ts
 *
 * Apply:
 *   npx tsx scripts/backfill-contact-mentions.ts --apply
 */

import { readFileSync } from "fs";

import { backfillSparsePersonsToMentions } from "@/lib/contacts/mention-backfill";

function loadDatabaseUrl(): string {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).trim();
      }
    }
  } catch {
    // optional when env is already set
  }
  return (
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@localhost:5433/condo_board"
  );
}

function parseArgs(argv: string[]) {
  let apply = false;
  let maxDetails = 80;
  let limit = 5000;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--max-details=")) {
      maxDetails = Number(arg.slice("--max-details=".length)) || 80;
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length)) || 5000;
    }
  }
  return { apply, maxDetails, limit };
}

async function main() {
  process.env.DATABASE_URL = loadDatabaseUrl();
  const { apply, maxDetails, limit } = parseArgs(process.argv.slice(2));

  console.log(
    apply
      ? "Applying sparse-person → mention backfill…"
      : "Dry-run sparse-person → mention backfill…",
  );

  const report = await backfillSparsePersonsToMentions({
    dryRun: !apply,
    limit,
  });

  console.log(
    JSON.stringify(
      {
        dryRun: report.dryRun,
        harvestEmails: report.harvestEmails,
        harvestMentionsWritten: report.harvestMentionsWritten,
        stubsConsidered: report.stubsConsidered,
        mentionsWritten: report.mentionsWritten,
        personsDeleted: report.personsDeleted,
        skippedNoEvidence: report.skippedNoEvidence,
        skippedNotSparse: report.skippedNotSparse,
        skippedNameMissing: report.skippedNameMissing,
        mentionsDropped: report.mentionsDropped,
        resolve: report.resolve,
        detailCount: report.details.length,
      },
      null,
      2,
    ),
  );

  for (const line of report.details.slice(0, maxDetails)) {
    console.log(line);
  }
  if (report.details.length > maxDetails) {
    console.log(`… ${report.details.length - maxDetails} more`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
