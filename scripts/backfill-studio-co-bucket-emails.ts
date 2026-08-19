/**
 * Pin co-bucketed ICC mailboxes back onto Studio after identity email move.
 * Run: npx tsx scripts/backfill-studio-co-bucket-emails.ts --apply
 */
import { readFileSync } from "fs";

import { loadOrganizationFieldDenials } from "../lib/organizations/field-denials";
import { pinOrganizationFieldAttachment } from "../lib/organizations/field-attachments";
import {
  loadOrganizationMergeHarvestCards,
  residualEmailsFromIdentityBucket,
  residualEmailsFromNamedHarvestCards,
  survivorOrgKeyForName,
} from "../lib/organizations/identity-email-bucket";
import { mergeOrgMultiValues } from "../lib/organizations/org-multi-values";

const STUDIO_NAME = "Studio on Richmond Management Office";

function loadDatabaseUrl(): string {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).trim();
      }
      if (trimmed.startsWith("COND_BOARD_POSTGRES_URL=")) {
        return trimmed.slice("COND_BOARD_POSTGRES_URL=".length).trim();
      }
    }
  } catch {
    // optional when env is already set
  }
  return (
    process.env.COND_BOARD_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@localhost:5433/condo_board"
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  process.env.DATABASE_URL = loadDatabaseUrl();
  process.env.COND_BOARD_POSTGRES_URL = loadDatabaseUrl();

  const denials = await loadOrganizationFieldDenials();
  const emailDenial = denials.find(
    (row) =>
      row.field === "email" &&
      row.deniedValue === "studiopm@iccpropertymanagement.com" &&
      row.nameKey === "studio on richmond management office",
  );
  if (!emailDenial) {
    console.log("No studiopm email move denial found; nothing to backfill.");
    return;
  }

  const survivorKey = survivorOrgKeyForName(STUDIO_NAME);
  if (!survivorKey) {
    console.log("Could not resolve survivor org key.");
    return;
  }

  const harvestCards = await loadOrganizationMergeHarvestCards();
  const nameKey = emailDenial.nameKey!;
  const residual = [
    ...residualEmailsFromIdentityBucket({
      identityOrgKey: emailDenial.orgKey,
      movedEmailNormalized: emailDenial.deniedValue,
      cards: harvestCards,
    }),
    ...residualEmailsFromNamedHarvestCards({
      nameKey,
      denials,
      cards: harvestCards,
    }),
  ];

  const unique = [...new Set(residual.map((value) => value.trim()).filter(Boolean))];
  console.log(`Survivor key: ${survivorKey}`);
  console.log(`Residual mailboxes (${unique.length}):`, unique);

  if (!apply) {
    console.log("Dry run. Re-run with --apply to pin these on the Studio card.");
    return;
  }

  for (const mailbox of unique) {
    const result = await pinOrganizationFieldAttachment({
      organizationId: survivorKey,
      field: "email",
      value: mailbox,
      organizationName: STUDIO_NAME,
    });
    if (!result.ok) {
      console.error("Failed to pin", mailbox, result.error);
    }
  }

  console.log(
    "Pinned mailboxes. Refresh Organizations — Email field should list:",
    mergeOrgMultiValues("email", ...unique),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
