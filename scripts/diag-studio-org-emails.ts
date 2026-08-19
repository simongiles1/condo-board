/**
 * Diagnose Studio org email denials / harvest buckets.
 * Run: npx tsx scripts/diag-studio-org-emails.ts
 */
import { readFileSync } from "fs";

import { isNull } from "drizzle-orm";

import { getDb } from "../lib/db";
import {
  organizationFieldAttachments,
  organizationFieldDenials,
  organizationFingerprintMerges,
  organizationHighlightExtractions,
} from "../lib/db/schema";
import { parseOrgFingerprintResult } from "../lib/email-analysis/org-highlight-shared";
import {
  normalizeOrgDeniedValue,
  normalizeOrgNameKey,
  orgIdentityKey,
} from "../lib/organizations/field-denials";
import { splitOrgMultiValue } from "../lib/organizations/org-multi-values";
import { loadOrgFingerprintSummaries } from "../lib/organizations/fingerprint-list";

const studioNeedle = "studio on richmond management office";

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
  process.env.DATABASE_URL = loadDatabaseUrl();
  process.env.COND_BOARD_POSTGRES_URL = loadDatabaseUrl();
  const db = getDb();

  const denials = await db.select().from(organizationFieldDenials);
  const studioDenials = denials.filter(
    (row) =>
      row.nameKey?.includes("studio") ||
      row.orgKey.includes("studiopm") ||
      row.deniedValue.includes("studiopm"),
  );
  console.log("Studio-related denials:", studioDenials.length);
  for (const row of studioDenials) {
    console.log(row);
  }

  const attachments = await db.select().from(organizationFieldAttachments);
  const studioAtt = attachments.filter(
    (row) =>
      row.nameKey?.includes("studio") ||
      row.orgKey.includes("studio") ||
      row.attachedValue.toLowerCase().includes("studiopm") ||
      row.attachedValue.toLowerCase().includes("icc"),
  );
  console.log("Studio/ICC attachments:", studioAtt.length);
  for (const row of studioAtt.slice(0, 30)) {
    console.log(row);
  }

  const mergeRows = await db
    .select({ entityCardsJson: organizationFingerprintMerges.entityCardsJson })
    .from(organizationFingerprintMerges)
    .where(isNull(organizationFingerprintMerges.error));

  const identityEmails = new Map<string, number>();
  const namedEmails = new Map<string, number>();
  for (const row of mergeRows) {
    let parsed: ReturnType<typeof parseOrgFingerprintResult>;
    try {
      parsed = parseOrgFingerprintResult(JSON.parse(row.entityCardsJson));
    } catch {
      continue;
    }
    for (const card of parsed.entity_cards) {
      const idKey = orgIdentityKey(card);
      if (idKey.includes("studiopm")) {
        for (const e of splitOrgMultiValue(card.email)) {
          const k = e.toLowerCase();
          identityEmails.set(k, (identityEmails.get(k) ?? 0) + 1);
        }
      }
      if (normalizeOrgNameKey(card.name) === studioNeedle) {
        for (const e of splitOrgMultiValue(card.email)) {
          const k = e.toLowerCase();
          namedEmails.set(k, (namedEmails.get(k) ?? 0) + 1);
        }
      }
    }
  }
  console.log("Pass-4 identity studiopm bucket emails:", [...identityEmails.entries()]);
  console.log("Pass-4 named Studio emails:", [...namedEmails.entries()]);

  const pass3 = await db
    .select({
      emailId: organizationHighlightExtractions.emailId,
      thirdPassExtractionJson:
        organizationHighlightExtractions.thirdPassExtractionJson,
    })
    .from(organizationHighlightExtractions)
    .limit(5000);

  const pass3Named = new Map<string, number>();
  const pass3Identity = new Map<string, number>();
  for (const row of pass3) {
    if (!row.thirdPassExtractionJson) continue;
    let parsed: ReturnType<typeof parseOrgFingerprintResult>;
    try {
      parsed = parseOrgFingerprintResult(JSON.parse(row.thirdPassExtractionJson));
    } catch {
      continue;
    }
    for (const card of parsed.entity_cards) {
      const idKey = orgIdentityKey(card);
      if (idKey.includes("studiopm")) {
        for (const e of splitOrgMultiValue(card.email)) {
          const k = e.toLowerCase();
          pass3Identity.set(k, (pass3Identity.get(k) ?? 0) + 1);
        }
      }
      if (normalizeOrgNameKey(card.name) === studioNeedle) {
        for (const e of splitOrgMultiValue(card.email)) {
          const k = e.toLowerCase();
          pass3Named.set(k, (pass3Named.get(k) ?? 0) + 1);
        }
      }
    }
  }
  console.log("Pass-3 identity studiopm bucket emails:", [...pass3Identity.entries()]);
  console.log("Pass-3 named Studio emails:", [...pass3Named.entries()]);

  const { organizations } = await loadOrgFingerprintSummaries({
    limit: 2000,
    sort: "mentions-desc",
  });
  const studio = organizations.find(
    (org) => normalizeOrgNameKey(org.name ?? org.displayName) === studioNeedle,
  );
  console.log("Loaded studio summary:", studio
    ? {
        id: studio.id,
        displayName: studio.displayName,
        email: studio.email,
        sourceEmailCount: studio.sourceEmailCount,
        aliases: studio.aliases,
      }
    : "NOT FOUND");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
