/**
 * Copy stored pass-3 org fingerprint cards into organization_mentions, then resolve.
 */

import { eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  organizationHighlightExtractions,
  organizationMentions,
} from "@/lib/db/schema";
import { parseOrgFingerprintResult } from "@/lib/email-analysis/org-highlight-shared";
import { upsertOrgMentionsForEmail, upsertPaintedOrgMentionSurfacesForEmail } from "@/lib/organizations/mention-persist";
import { resolveOrgMentions } from "@/lib/organizations/mention-resolve";

export type BackfillOrgMentionsResult = {
  dryRun: boolean;
  harvestEmails: number;
  harvestEmailsSkippedEmpty: number;
  harvestMentionsWritten: number;
  harvestMentionsSkipped: number;
  harvestEmailsMarkedAbsent: number;
  harvestRemaining: number;
  harvestSkipped: boolean;
  resolve: Awaited<ReturnType<typeof resolveOrgMentions>> | null;
  details: string[];
};

export type OrgMentionBackfillStatusCounts = {
  unresolved: number;
  provisional: number;
  confirmed: number;
};

export type PreviewOrgMentionBackfill = {
  existingMentions: number;
  harvestEmails: number;
  /** Pass-3 emails with org cards but no mention rows yet. */
  pendingHarvestEmails: number;
  /** Pass-3 parsed to zero org cards — nothing to copy; counts as done. */
  emptyPass3Emails: number;
  /** Pass-3 had org cards but none appear in this email — counts as done. */
  absentPass3Emails: number;
  /** Pass-3 JSON could not be parsed — still needs attention. */
  invalidPass3Emails: number;
  processedHarvestEmails: number;
  emailsWithMentions: number;
  harvestNeeded: boolean;
  mentionStatus: OrgMentionBackfillStatusCounts;
};

/** Card count when JSON parses; 0 when empty; null when invalid. */
export function pass3OrgEntityCardCount(
  json: string | null | undefined,
): number | null {
  if (!json) return 0;
  try {
    return parseOrgFingerprintResult(JSON.parse(json)).entity_cards.length;
  } catch {
    return null;
  }
}

function classifyPass3HarvestRow(
  row: {
    emailId: string;
    thirdPassExtractionJson: string | null;
    orgMentionsBackfilledAt?: string | null;
  },
  mentionedEmailIds: Set<string>,
): "done" | "pending" | "empty" | "invalid" | "absent" {
  if (mentionedEmailIds.has(row.emailId)) return "done";
  if (row.orgMentionsBackfilledAt) return "absent";
  const cardCount = pass3OrgEntityCardCount(row.thirdPassExtractionJson);
  if (cardCount === null) return "invalid";
  if (cardCount === 0) return "empty";
  return "pending";
}

async function markOrgMentionBackfillAbsent(params: { emailId: string }) {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(organizationHighlightExtractions)
    .set({ orgMentionsBackfilledAt: now, updatedAt: now })
    .where(eq(organizationHighlightExtractions.emailId, params.emailId));
}

async function loadHarvestRows(
  db: ReturnType<typeof getDb>,
  opts: { pendingOnly: boolean },
) {
  const harvestRows = await db
    .select({
      emailId: organizationHighlightExtractions.emailId,
      modelId: organizationHighlightExtractions.modelId,
      thirdPassExtractionJson:
        organizationHighlightExtractions.thirdPassExtractionJson,
      orgMentionsBackfilledAt:
        organizationHighlightExtractions.orgMentionsBackfilledAt,
    })
    .from(organizationHighlightExtractions)
    .where(isNotNull(organizationHighlightExtractions.thirdPassExtractionJson));

  if (!opts.pendingOnly) return harvestRows;

  const mentioned = await db
    .selectDistinct({ sourceEmailId: organizationMentions.sourceEmailId })
    .from(organizationMentions);
  const have = new Set(
    mentioned
      .map((row) => row.sourceEmailId)
      .filter((id): id is string => Boolean(id)),
  );
  return harvestRows.filter(
    (row) => classifyPass3HarvestRow(row, have) === "pending",
  );
}

async function loadOrgMentionStatusCounts(
  db: ReturnType<typeof getDb>,
): Promise<OrgMentionBackfillStatusCounts> {
  const rows = await db
    .select({
      status: organizationMentions.resolutionStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(organizationMentions)
    .groupBy(organizationMentions.resolutionStatus);
  const counts: OrgMentionBackfillStatusCounts = {
    unresolved: 0,
    provisional: 0,
    confirmed: 0,
  };
  for (const row of rows) {
    if (row.status === "unresolved") counts.unresolved = Number(row.count) || 0;
    else if (row.status === "provisional")
      counts.provisional = Number(row.count) || 0;
    else if (row.status === "confirmed") counts.confirmed = Number(row.count) || 0;
  }
  return counts;
}

export async function previewOrgMentionBackfill(): Promise<PreviewOrgMentionBackfill> {
  const db = getDb();
  const [mentionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationMentions);
  const [emailRow] = await db
    .select({
      count: sql<number>`count(distinct ${organizationMentions.sourceEmailId})::int`,
    })
    .from(organizationMentions);
  const [allHarvestRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationHighlightExtractions)
    .where(isNotNull(organizationHighlightExtractions.thirdPassExtractionJson));
  const allHarvestRows = await loadHarvestRows(db, { pendingOnly: false });
  const mentioned = await db
    .selectDistinct({ sourceEmailId: organizationMentions.sourceEmailId })
    .from(organizationMentions);
  const mentionedEmailIds = new Set(
    mentioned
      .map((row) => row.sourceEmailId)
      .filter((id): id is string => Boolean(id)),
  );
  let emptyPass3Emails = 0;
  let absentPass3Emails = 0;
  let invalidPass3Emails = 0;
  for (const row of allHarvestRows) {
    const kind = classifyPass3HarvestRow(row, mentionedEmailIds);
    if (kind === "empty") emptyPass3Emails += 1;
    else if (kind === "absent") absentPass3Emails += 1;
    else if (kind === "invalid") invalidPass3Emails += 1;
  }
  const pendingHarvest = await loadHarvestRows(db, { pendingOnly: true });
  const harvestEmails = Number(allHarvestRow?.count) || 0;
  const pendingHarvestEmails = pendingHarvest.length;
  const emailsWithMentions = Number(emailRow?.count) || 0;

  return {
    existingMentions: Number(mentionRow?.count) || 0,
    harvestEmails,
    pendingHarvestEmails,
    emptyPass3Emails,
    absentPass3Emails,
    invalidPass3Emails,
    processedHarvestEmails:
      emailsWithMentions + emptyPass3Emails + absentPass3Emails,
    emailsWithMentions,
    harvestNeeded: pendingHarvestEmails > 0 || invalidPass3Emails > 0,
    mentionStatus: await loadOrgMentionStatusCounts(db),
  };
}

export async function backfillOrgMentionsFromHarvest(params?: {
  dryRun?: boolean;
  force?: boolean;
  harvestLimit?: number;
}): Promise<BackfillOrgMentionsResult> {
  const dryRun = params?.dryRun !== false;
  const db = getDb();
  const pendingOnly = params?.force !== true;
  const pendingHarvest = await loadHarvestRows(db, { pendingOnly });
  const harvestLimit = params?.harvestLimit;
  const harvestRows =
    harvestLimit && harvestLimit > 0
      ? pendingHarvest.slice(0, harvestLimit)
      : pendingHarvest;

  const result: BackfillOrgMentionsResult = {
    dryRun,
    harvestEmails: harvestRows.length,
    harvestEmailsSkippedEmpty: 0,
    harvestMentionsWritten: 0,
    harvestMentionsSkipped: 0,
    harvestEmailsMarkedAbsent: 0,
    harvestRemaining: Math.max(0, pendingHarvest.length - harvestRows.length),
    harvestSkipped: pendingHarvest.length === 0,
    resolve: null,
    details: [],
  };

  if (result.harvestSkipped) {
    result.details.push("skip harvest replay — no pending pass-3 emails");
    return result;
  }

  const touchedEmailIds = new Set<string>();

  for (const row of harvestRows) {
    if (!row.thirdPassExtractionJson) continue;
    let cards: ReturnType<typeof parseOrgFingerprintResult>["entity_cards"] = [];
    try {
      cards = parseOrgFingerprintResult(JSON.parse(row.thirdPassExtractionJson))
        .entity_cards;
    } catch {
      result.details.push(`skip ${row.emailId.slice(0, 8)}… — invalid pass-3 JSON`);
      continue;
    }
    if (cards.length === 0) {
      result.harvestEmailsSkippedEmpty += 1;
      continue;
    }
    if (dryRun) {
      result.harvestMentionsWritten += cards.length;
      touchedEmailIds.add(row.emailId);
      continue;
    }
    const upsert = await upsertOrgMentionsForEmail({
      sourceEmailId: row.emailId,
      entityCards: cards,
      modelId: row.modelId,
    });
    const painted = await upsertPaintedOrgMentionSurfacesForEmail(row.emailId);
    result.harvestMentionsWritten += upsert.written + painted;
    result.harvestMentionsSkipped += upsert.skipped;
    if (
      !upsert.emailMissing &&
      upsert.written === 0 &&
      painted === 0 &&
      cards.length > 0 &&
      upsert.skipped > 0
    ) {
      await markOrgMentionBackfillAbsent({ emailId: row.emailId });
      result.harvestEmailsMarkedAbsent += 1;
      result.details.push(
        `mark ${row.emailId.slice(0, 8)}… absent — pass-3 org cards not in email body`,
      );
    } else if (upsert.written > 0 || painted > 0) {
      touchedEmailIds.add(row.emailId);
    }
  }

  if (!dryRun) {
    const ids = [...touchedEmailIds];
    let scanned = 0;
    let confirmed = 0;
    let provisional = 0;
    let unresolved = 0;
    let retracted = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const batch = await resolveOrgMentions({
        emailIds: ids.slice(i, i + 400),
        limit: 4000,
      });
      scanned += batch.scanned;
      confirmed += batch.confirmed;
      provisional += batch.provisional;
      unresolved += batch.unresolved;
      retracted += batch.retracted;
    }
    const isPartialBatch = Boolean(harvestLimit && harvestLimit > 0);
    if (!isPartialBatch) {
      while (true) {
        const leftover = await resolveOrgMentions({ limit: 2000 });
        scanned += leftover.scanned;
        confirmed += leftover.confirmed;
        provisional += leftover.provisional;
        unresolved += leftover.unresolved;
        retracted += leftover.retracted;
        if (leftover.scanned === 0) break;
      }
    }
    result.resolve = {
      scanned,
      confirmed,
      provisional,
      unresolved,
      retracted,
    };
  }

  if (!dryRun) {
    const remaining = await loadHarvestRows(db, { pendingOnly });
    result.harvestRemaining = remaining.length;
  }

  if (result.harvestRemaining > 0) {
    result.details.push(
      `${result.harvestRemaining} harvest email${result.harvestRemaining === 1 ? "" : "s"} remaining — re-run to continue`,
    );
  }

  return result;
}
