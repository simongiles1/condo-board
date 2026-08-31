/**
 * Copy stored pass-3 project fingerprints into project_mentions, then resolve.
 *
 * Dry run:
 *   npm run backfill:project-mentions
 *
 * Apply:
 *   npm run backfill:project-mentions -- --apply
 *
 * Replay all pass-3 rows (not only emails missing mentions):
 *   npm run backfill:project-mentions -- --apply --force
 */

import { readFileSync } from "fs";

import {
  backfillProjectMentionsFromHarvest,
  previewProjectMentionBackfill,
} from "@/lib/projects/mention-backfill";

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
  let force = false;
  let maxDetails = 40;
  let harvestLimit = 0;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--max-details=")) {
      maxDetails = Number(arg.slice("--max-details=".length)) || 40;
    } else if (arg.startsWith("--harvest-limit=")) {
      harvestLimit = Number(arg.slice("--harvest-limit=".length)) || 0;
    }
  }
  return { apply, force, maxDetails, harvestLimit };
}

async function main() {
  process.env.DATABASE_URL = loadDatabaseUrl();
  const { apply, force, maxDetails, harvestLimit } = parseArgs(
    process.argv.slice(2),
  );

  const preview = await previewProjectMentionBackfill();
  console.log(
    apply
      ? "Applying pass-3 → project_mentions backfill…"
      : "Dry-run pass-3 → project_mentions backfill…",
  );
  console.log(
    JSON.stringify(
      {
        existingMentions: preview.existingMentions,
        pass3Emails: preview.harvestEmails,
        pendingHarvestEmails: preview.pendingHarvestEmails,
        force,
        harvestLimit: harvestLimit > 0 ? harvestLimit : "all pending",
      },
      null,
      2,
    ),
  );

  const report = await backfillProjectMentionsFromHarvest({
    dryRun: !apply,
    force,
    harvestLimit: harvestLimit > 0 ? harvestLimit : undefined,
  });

  console.log(
    JSON.stringify(
      {
        dryRun: report.dryRun,
        harvestEmails: report.harvestEmails,
        harvestEmailsSkippedEmpty: report.harvestEmailsSkippedEmpty,
        harvestMentionsWritten: report.harvestMentionsWritten,
        harvestMentionsSkipped: report.harvestMentionsSkipped,
        harvestRemaining: report.harvestRemaining,
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

  if (!apply) {
    console.log("\nNo changes written. Re-run with --apply to persist.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
