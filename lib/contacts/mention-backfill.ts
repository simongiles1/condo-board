/**
 * Convert sparse first-name contact_persons into contact_mentions, then resolve.
 */

import { inArray, isNotNull, sql } from "drizzle-orm";

import {
  filterEmailIdsWhereMentionAppears,
  listMentionIdsMissingFromSourceEmail,
  loadMergedHighlightExtraction,
  upsertContactMentionsForEmail,
} from "@/lib/contacts/mention-persist";
import { resolveContactMentions } from "@/lib/contacts/mention-resolve";
import { collectCandidateEmailIdsByPersonIds } from "@/lib/contacts/registry-evidence";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import { getDb } from "@/lib/db";
import {
  contactHighlightExtractions,
  contactMentions,
  contactMergeProposals,
  contactPersons,
  personOrganizationAffiliations,
} from "@/lib/db/schema";
import { parseContactFingerprintResult } from "@/lib/email-analysis/contact-highlight-shared";

export type BackfillContactMentionsResult = {
  dryRun: boolean;
  harvestEmails: number;
  harvestMentionsWritten: number;
  harvestSkipped: boolean;
  harvestRemaining: number;
  stubsConsidered: number;
  mentionsWritten: number;
  personsDeleted: number;
  skippedNoEvidence: number;
  skippedNotSparse: number;
  skippedNameMissing: number;
  mentionsDropped: number;
  resolve: Awaited<ReturnType<typeof resolveContactMentions>> | null;
  details: string[];
};

export type PreviewContactMentionBackfill = {
  existingMentions: number;
  harvestEmails: number;
  pendingHarvestEmails: number;
  stubsConsidered: number;
  harvestNeeded: boolean;
  stubsNeeded: boolean;
  ghostMentions: number;
  ghostsNeeded: boolean;
};

export async function previewContactMentionBackfill(): Promise<PreviewContactMentionBackfill> {
  const db = getDb();
  const [mentionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactMentions);
  const harvestRows = await loadHarvestRows(db, { pendingOnly: true });

  const persons = await loadContactRegistryPersons({
    limit: 5000,
    skipVerifiedMentions: true,
  });
  const stubsConsidered = persons.filter(isSparsePerson).length;
  const existingMentions = Number(mentionRow?.count) || 0;
  const [allHarvestRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactHighlightExtractions)
    .where(isNotNull(contactHighlightExtractions.thirdPassExtractionJson));

  const ghostMentions = await countMentionsMissingFromSourceEmail();

  return {
    existingMentions,
    harvestEmails: Number(allHarvestRow?.count) || 0,
    pendingHarvestEmails: harvestRows.length,
    stubsConsidered,
    harvestNeeded: harvestRows.length > 0,
    stubsNeeded: stubsConsidered > 0,
    ghostMentions,
    ghostsNeeded: ghostMentions > 0,
  };
}

async function loadHarvestRows(
  db: ReturnType<typeof getDb>,
  opts: { pendingOnly: boolean },
) {
  const harvestRows = await db
    .select({
      emailId: contactHighlightExtractions.emailId,
      modelId: contactHighlightExtractions.modelId,
      thirdPassExtractionJson:
        contactHighlightExtractions.thirdPassExtractionJson,
    })
    .from(contactHighlightExtractions)
    .where(isNotNull(contactHighlightExtractions.thirdPassExtractionJson));
  if (!opts.pendingOnly) return harvestRows;

  const mentioned = await db
    .selectDistinct({ sourceEmailId: contactMentions.sourceEmailId })
    .from(contactMentions);
  const have = new Set(
    mentioned
      .map((row) => row.sourceEmailId)
      .filter((id): id is string => Boolean(id)),
  );
  return harvestRows.filter((row) => !have.has(row.emailId));
}

function isSparsePerson(person: {
  firstName: string | null;
  lastName: string | null;
  sparseStub: boolean;
  emails: Array<{ email: string }>;
  phones: Array<{ phone: string }>;
}): boolean {
  const first = person.firstName?.trim() || null;
  const last = person.lastName?.trim() || null;
  if (last || person.emails.length > 0 || person.phones.length > 0) {
    return false;
  }
  return Boolean(person.sparseStub || first);
}

async function listMentionsMissingFromSourceEmail(): Promise<string[]> {
  return listMentionIdsMissingFromSourceEmail();
}

async function countMentionsMissingFromSourceEmail(): Promise<number> {
  return (await listMentionsMissingFromSourceEmail()).length;
}

async function pruneMentionsMissingFromSourceEmail(params: {
  dryRun: boolean;
}): Promise<number> {
  const missing = await listMentionsMissingFromSourceEmail();
  if (params.dryRun || missing.length === 0) return missing.length;
  const db = getDb();
  for (let i = 0; i < missing.length; i += 200) {
    await db
      .delete(contactMentions)
      .where(inArray(contactMentions.id, missing.slice(i, i + 200)));
  }
  return missing.length;
}

export async function backfillSparsePersonsToMentions(params?: {
  dryRun?: boolean;
  limit?: number;
  /** Replay pass-3 cards even when some emails already have mentions. */
  forceHarvest?: boolean;
  /** UI batches; omit to process every pending harvest email (CLI). */
  harvestLimit?: number;
}): Promise<BackfillContactMentionsResult> {
  const dryRun = params?.dryRun !== false;
  const limit = params?.limit ?? 5000;
  const persons = await loadContactRegistryPersons({
    limit,
    skipVerifiedMentions: true,
  });

  const stubs = persons.filter(isSparsePerson);
  const emailIdsByPerson = await collectCandidateEmailIdsByPersonIds(
    stubs.map((person) => person.id),
  );

  const result: BackfillContactMentionsResult = {
    dryRun,
    harvestEmails: 0,
    harvestMentionsWritten: 0,
    harvestSkipped: false,
    harvestRemaining: 0,
    stubsConsidered: stubs.length,
    mentionsWritten: 0,
    personsDeleted: 0,
    skippedNoEvidence: 0,
    skippedNotSparse: 0,
    skippedNameMissing: 0,
    mentionsDropped: 0,
    resolve: null,
    details: [],
  };

  const db = getDb();
  const pendingOnly = params?.forceHarvest !== true;
  const pendingHarvest = await loadHarvestRows(db, { pendingOnly });
  const harvestLimit = params?.harvestLimit;
  const harvestRows =
    harvestLimit && harvestLimit > 0
      ? pendingHarvest.slice(0, harvestLimit)
      : pendingHarvest;
  result.harvestRemaining = Math.max(0, pendingHarvest.length - harvestRows.length);
  result.harvestSkipped = pendingHarvest.length === 0;
  result.harvestEmails = harvestRows.length;
  if (result.harvestSkipped) {
    result.details.push("skip harvest replay — no pending pass-3 emails");
  }
  const touchedEmailIds = new Set<string>();

  for (const row of harvestRows) {
    if (!row.thirdPassExtractionJson) continue;
    let cards: ReturnType<
      typeof parseContactFingerprintResult
    >["entity_cards"] = [];
    try {
      cards = parseContactFingerprintResult(
        JSON.parse(row.thirdPassExtractionJson),
      ).entity_cards;
    } catch {
      continue;
    }
    if (cards.length === 0) continue;
    if (dryRun) {
      result.harvestMentionsWritten += cards.length;
      touchedEmailIds.add(row.emailId);
      continue;
    }
    const extraction = await loadMergedHighlightExtraction(
      row.emailId,
      row.modelId,
    );
    const written = await upsertContactMentionsForEmail({
      sourceEmailId: row.emailId,
      entityCards: cards,
      extraction,
      modelId: row.modelId,
    });
    result.harvestMentionsWritten += written.written;
    touchedEmailIds.add(row.emailId);
  }

  async function resolveTouched() {
    if (dryRun) return;
    const ids = [...touchedEmailIds];
    if (ids.length === 0) return;
    let scanned = 0;
    let confirmed = 0;
    let provisional = 0;
    let unresolved = 0;
    let retracted = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const batch = await resolveContactMentions({
        emailIds: ids.slice(i, i + 400),
        limit: 4000,
      });
      scanned += batch.scanned;
      confirmed += batch.confirmed;
      provisional += batch.provisional;
      unresolved += batch.unresolved;
      retracted += batch.retracted;
    }
    result.resolve = {
      scanned,
      confirmed,
      provisional,
      unresolved,
      retracted,
    };
  }

  if (result.harvestRemaining > 0) {
    result.details.push(
      `${result.harvestRemaining} harvest emails remaining`,
    );
    await resolveTouched();
    return result;
  }

  const deleteIds: string[] = [];

  for (const person of stubs) {
    const candidateIds = [...(emailIdsByPerson.get(person.id) ?? [])];
    if (candidateIds.length === 0) {
      result.skippedNoEvidence += 1;
      result.details.push(
        `skip ${person.id} ${person.firstName ?? "(no name)"} — no source emails`,
      );
      continue;
    }

    const card = {
      first_name: person.firstName,
      last_name: person.lastName,
      email: null,
      phone: null,
      job_title: person.titles[0]?.title ?? null,
      raw_company: person.currentOrganizationName,
    };
    const emailIds = await filterEmailIdsWhereMentionAppears(
      candidateIds,
      card,
    );
    if (emailIds.length === 0) {
      result.skippedNameMissing += 1;
      result.details.push(
        `skip ${person.id} ${person.firstName ?? "(no name)"} — name not on evidence emails`,
      );
      deleteIds.push(person.id);
      continue;
    }

    if (!dryRun) {
      for (const emailId of emailIds) {
        const written = await upsertContactMentionsForEmail({
          sourceEmailId: emailId,
          entityCards: [card],
        });
        result.mentionsWritten += written.written;
        touchedEmailIds.add(emailId);
      }
    } else {
      result.mentionsWritten += emailIds.length;
      for (const emailId of emailIds) touchedEmailIds.add(emailId);
    }

    deleteIds.push(person.id);
    result.details.push(
      `convert ${person.id} ${person.firstName ?? "(no name)"} ← ${emailIds.length} emails`,
    );
  }

  if (!dryRun && deleteIds.length > 0) {
    await db
      .delete(personOrganizationAffiliations)
      .where(inArray(personOrganizationAffiliations.personId, deleteIds));

    await db
      .update(contactMergeProposals)
      .set({ resultPersonId: null, targetPersonId: null })
      .where(inArray(contactMergeProposals.resultPersonId, deleteIds));

    await db
      .delete(contactPersons)
      .where(inArray(contactPersons.id, deleteIds));
    result.personsDeleted = deleteIds.length;
  } else {
    result.personsDeleted = dryRun ? deleteIds.length : 0;
  }

  result.mentionsDropped = await pruneMentionsMissingFromSourceEmail({
    dryRun,
  });
  if (result.mentionsDropped > 0) {
    result.details.push(
      `${dryRun ? "would drop" : "dropped"} ${result.mentionsDropped} mention${
        result.mentionsDropped === 1 ? "" : "s"
      } not present on the source email`,
    );
  }

  await resolveTouched();
  if (!dryRun) {
    const leftover = await resolveContactMentions({ limit: 8000 });
    result.resolve = result.resolve
      ? {
          scanned: result.resolve.scanned + leftover.scanned,
          confirmed: result.resolve.confirmed + leftover.confirmed,
          provisional: result.resolve.provisional + leftover.provisional,
          unresolved: result.resolve.unresolved + leftover.unresolved,
          retracted: result.resolve.retracted + leftover.retracted,
        }
      : leftover;
    result.details.push(
      `matcher scanned ${leftover.scanned} unresolved mention${leftover.scanned === 1 ? "" : "s"}`,
    );
  }

  return result;
}
