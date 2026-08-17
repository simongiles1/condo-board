/**
 * Cleanup shared/role mailbox contact registry contamination.
 *
 * Dry run:
 *   npx tsx scripts/cleanup-shared-mailbox-registry.ts
 *   npx tsx scripts/cleanup-shared-mailbox-registry.ts --email=studiopm@iccpropertymanagement.com
 *
 * Apply:
 *   npx tsx scripts/cleanup-shared-mailbox-registry.ts --apply
 *   npx tsx scripts/cleanup-shared-mailbox-registry.ts --apply --email=studiopm@iccpropertymanagement.com
 */

import { readFileSync } from "fs";

import { cleanupSharedMailboxRegistry } from "@/lib/contacts/registry-cleanup";

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
  let email: string | null = null;
  let maxDetails = 80;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim() || null;
    } else if (arg.startsWith("--max-details=")) {
      maxDetails = Number(arg.slice("--max-details=".length)) || 80;
    }
  }
  return { apply, email, maxDetails };
}

async function main() {
  process.env.DATABASE_URL = loadDatabaseUrl();
  const { apply, email, maxDetails } = parseArgs(process.argv.slice(2));

  console.log(
    apply
      ? `Applying shared-mailbox cleanup${email ? ` for ${email}` : ""}…`
      : `Dry-run shared-mailbox cleanup${email ? ` for ${email}` : ""}…`,
  );

  const report = await cleanupSharedMailboxRegistry({
    dryRun: !apply,
    emailFilter: email,
  });

  console.log(
    JSON.stringify(
      {
        dryRun: report.dryRun,
        emailsConsidered: report.emailsConsidered,
        namesRepaired: report.namesRepaired,
        duplicatesMerged: report.duplicatesMerged,
        occupancyRowsUpdated: report.occupancyRowsUpdated,
        openRangesClosed: report.openRangesClosed,
        detailCount: report.details.length,
      },
      null,
      2,
    ),
  );

  const shown = report.details.slice(0, maxDetails);
  for (const line of shown) {
    console.log(`- ${line}`);
  }
  if (report.details.length > shown.length) {
    console.log(`… ${report.details.length - shown.length} more details`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to write changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
