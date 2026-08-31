/**
 * Copy stored pass-3 project fingerprint cards into project_mentions, then resolve.
 * No AI calls — replays what saveProjectHighlightThirdPass would have written.
 */

import { and, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectHighlightExtractions, projectMentions } from "@/lib/db/schema";
import { parseProjectFingerprintResult } from "@/lib/email-analysis/project-highlight-shared";
import { upsertProjectMentionsForEmail } from "@/lib/projects/mention-persist";
import { resolveProjectMentions } from "@/lib/projects/mention-resolve";

export type BackfillProjectMentionsResult = {
  dryRun: boolean;
  harvestEmails: number;
  harvestEmailsSkippedEmpty: number;
  harvestMentionsWritten: number;
  harvestMentionsSkipped: number;
  harvestRemaining: number;
  harvestSkipped: boolean;
  resolve: Awaited<ReturnType<typeof resolveProjectMentions>> | null;
  details: string[];
};

export type PreviewProjectMentionBackfill = {
  existingMentions: number;
  harvestEmails: number;
  pendingHarvestEmails: number;
  harvestNeeded: boolean;
};

async function loadHarvestRows(
  db: ReturnType<typeof getDb>,
  opts: { pendingOnly: boolean },
) {
  const harvestRows = await db
    .select({
      emailId: projectHighlightExtractions.emailId,
      modelId: projectHighlightExtractions.modelId,
      thirdPassExtractionJson:
        projectHighlightExtractions.thirdPassExtractionJson,
      thirdPassError: projectHighlightExtractions.thirdPassError,
    })
    .from(projectHighlightExtractions)
    .where(isNotNull(projectHighlightExtractions.thirdPassExtractionJson));

  if (!opts.pendingOnly) return harvestRows;

  const mentioned = await db
    .selectDistinct({ sourceEmailId: projectMentions.sourceEmailId })
    .from(projectMentions);
  const have = new Set(
    mentioned
      .map((row) => row.sourceEmailId)
      .filter((id): id is string => Boolean(id)),
  );
  return harvestRows.filter((row) => !have.has(row.emailId));
}

export async function previewProjectMentionBackfill(): Promise<PreviewProjectMentionBackfill> {
  const db = getDb();
  const [mentionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectMentions);
  const [allHarvestRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectHighlightExtractions)
    .where(isNotNull(projectHighlightExtractions.thirdPassExtractionJson));
  const pendingHarvest = await loadHarvestRows(db, { pendingOnly: true });

  return {
    existingMentions: Number(mentionRow?.count) || 0,
    harvestEmails: Number(allHarvestRow?.count) || 0,
    pendingHarvestEmails: pendingHarvest.length,
    harvestNeeded: pendingHarvest.length > 0,
  };
}

function parseHarvestCards(
  thirdPassExtractionJson: string,
): ReturnType<typeof parseProjectFingerprintResult>["entity_cards"] {
  return parseProjectFingerprintResult(
    JSON.parse(thirdPassExtractionJson),
  ).entity_cards;
}

async function resolveTouchedEmailIds(params: {
  dryRun: boolean;
  emailIds: Set<string>;
}): Promise<Awaited<ReturnType<typeof resolveProjectMentions>> | null> {
  if (params.dryRun || params.emailIds.size === 0) return null;

  const ids = [...params.emailIds];
  let scanned = 0;
  let confirmed = 0;
  let provisional = 0;
  let unresolved = 0;
  let retracted = 0;

  for (let i = 0; i < ids.length; i += 400) {
    const batch = await resolveProjectMentions({
      emailIds: ids.slice(i, i + 400),
      limit: 4000,
    });
    scanned += batch.scanned;
    confirmed += batch.confirmed;
    provisional += batch.provisional;
    unresolved += batch.unresolved;
    retracted += batch.retracted;
  }

  return { scanned, confirmed, provisional, unresolved, retracted };
}

export async function backfillProjectMentionsFromHarvest(params?: {
  dryRun?: boolean;
  /** Replay pass-3 cards even when the source email already has mentions. */
  force?: boolean;
  /** Cap harvest emails processed in one run (CLI batches). */
  harvestLimit?: number;
}): Promise<BackfillProjectMentionsResult> {
  const dryRun = params?.dryRun !== false;
  const db = getDb();
  const pendingOnly = params?.force !== true;
  const pendingHarvest = await loadHarvestRows(db, { pendingOnly });
  const harvestLimit = params?.harvestLimit;
  const harvestRows =
    harvestLimit && harvestLimit > 0
      ? pendingHarvest.slice(0, harvestLimit)
      : pendingHarvest;

  const result: BackfillProjectMentionsResult = {
    dryRun,
    harvestEmails: harvestRows.length,
    harvestEmailsSkippedEmpty: 0,
    harvestMentionsWritten: 0,
    harvestMentionsSkipped: 0,
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

    let cards: ReturnType<typeof parseHarvestCards> = [];
    try {
      cards = parseHarvestCards(row.thirdPassExtractionJson);
    } catch {
      result.details.push(
        `skip ${row.emailId.slice(0, 8)}… — invalid pass-3 JSON`,
      );
      continue;
    }

    if (cards.length === 0) {
      result.harvestEmailsSkippedEmpty += 1;
      if (row.thirdPassError) {
        result.details.push(
          `skip ${row.emailId.slice(0, 8)}… — empty cards (${row.thirdPassError.slice(0, 80)}…)`,
        );
      }
      continue;
    }

    if (dryRun) {
      result.harvestMentionsWritten += cards.length;
      touchedEmailIds.add(row.emailId);
      continue;
    }

    const written = await upsertProjectMentionsForEmail({
      sourceEmailId: row.emailId,
      entityCards: cards,
      modelId: row.modelId,
    });
    result.harvestMentionsWritten += written.written;
    result.harvestMentionsSkipped += written.skipped;
    touchedEmailIds.add(row.emailId);
  }

  result.resolve = await resolveTouchedEmailIds({ dryRun, emailIds: touchedEmailIds });

  if (!dryRun) {
    const leftover = await resolveProjectMentions({ limit: 8000 });
    result.resolve = result.resolve
      ? {
          scanned: result.resolve.scanned + leftover.scanned,
          confirmed: result.resolve.confirmed + leftover.confirmed,
          provisional: result.resolve.provisional + leftover.provisional,
          unresolved: result.resolve.unresolved + leftover.unresolved,
          retracted: result.resolve.retracted + leftover.retracted,
        }
      : leftover;
    if (leftover.scanned > 0) {
      result.details.push(
        `matcher scanned ${leftover.scanned} additional unresolved mention${leftover.scanned === 1 ? "" : "s"}`,
      );
    }
  }

  if (result.harvestRemaining > 0) {
    result.details.push(
      `${result.harvestRemaining} harvest email${result.harvestRemaining === 1 ? "" : "s"} remaining — re-run to continue`,
    );
  }

  return result;
}

/** Drop mentions for emails that no longer have pass-3 JSON (optional cleanup). */
export async function pruneProjectMentionsWithoutPass3(params?: {
  dryRun?: boolean;
}): Promise<number> {
  const dryRun = params?.dryRun !== false;
  const db = getDb();
  const rows = await db
    .selectDistinct({ sourceEmailId: projectMentions.sourceEmailId })
    .from(projectMentions);
  const emailIds = rows
    .map((row) => row.sourceEmailId)
    .filter((id): id is string => Boolean(id));
  if (emailIds.length === 0) return 0;

  const withPass3 = await db
    .select({ emailId: projectHighlightExtractions.emailId })
    .from(projectHighlightExtractions)
    .where(
      and(
        inArray(projectHighlightExtractions.emailId, emailIds),
        isNotNull(projectHighlightExtractions.thirdPassExtractionJson),
      ),
    );
  const havePass3 = new Set(withPass3.map((row) => row.emailId));
  const orphanIds = emailIds.filter((id) => !havePass3.has(id));
  if (orphanIds.length === 0 || dryRun) return orphanIds.length;

  for (let i = 0; i < orphanIds.length; i += 200) {
    await db
      .delete(projectMentions)
      .where(inArray(projectMentions.sourceEmailId, orphanIds.slice(i, i + 200)));
  }
  return orphanIds.length;
}
