/**
 * Load grouped contact mentions for the Contacts Mentions tab, and attach
 * an unresolved group to a canonical person.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  buildMentionQueueGroups,
  extractMentionContextSnippet,
  filterAttachMentionIds,
  mentionContextTerms,
  mentionMatchesQueueGroup,
  parseMentionQueueGroupId,
  parseMentionQueueView,
  pickRichestMentionCard,
  rowsForMentionQueueView,
  type ContactMentionStats,
  type MentionQueueGroup,
  type MentionQueueRow,
  type MentionQueueView,
} from "@/lib/contacts/mention-queue-shared";
import { mentionCardAppearsInEmail, mentionSearchBody } from "@/lib/contacts/mention-presence";
import { mentionMatchingFirstNameKey } from "@/lib/contacts/mention-shared";
import { lastNamesCompatible } from "@/lib/contacts/person-name";
import { createPersonFromCard } from "@/lib/contacts/registry-apply";
import { personDisplayName } from "@/lib/contacts/registry-shared";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import { getDb } from "@/lib/db";
import { contactMentions, contactPersons, emails } from "@/lib/db/schema";

const THREAD_PARTICIPANT_SAMPLE_LIMIT = 400;
const UNRESOLVED_LOAD_LIMIT = 8000;

export async function getContactMentionStats(): Promise<ContactMentionStats> {
  const db = getDb();
  const rows = await db
    .select({
      status: contactMentions.resolutionStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(contactMentions)
    .groupBy(contactMentions.resolutionStatus);

  const stats: ContactMentionStats = {
    total: 0,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
    fullName: 0,
  };
  for (const row of rows) {
    const count = Number(row.count) || 0;
    stats.total += count;
    if (row.status === "confirmed") stats.confirmed = count;
    else if (row.status === "provisional") stats.provisional = count;
    else if (row.status === "unresolved") stats.unresolved = count;
  }

  const [fullNameRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactMentions)
    .where(
      and(
        eq(contactMentions.resolutionStatus, "unresolved"),
        sql`nullif(btrim(${contactMentions.firstName}), '') is not null`,
        sql`nullif(btrim(${contactMentions.lastName}), '') is not null`,
      ),
    );
  stats.fullName = Number(fullNameRow?.count) || 0;
  return stats;
}

function mentionKindFromDb(
  value: string,
): MentionQueueRow["mentionKind"] {
  if (value === "participant" || value === "referred") return value;
  return "unknown";
}

function statusFromDb(value: string): MentionQueueRow["resolutionStatus"] {
  if (value === "confirmed" || value === "provisional") return value;
  return "unresolved";
}

export async function loadMentionQueueGroups(params?: {
  view?: MentionQueueView | string | null;
}): Promise<{
  view: MentionQueueView;
  groups: MentionQueueGroup[];
  stats: ContactMentionStats;
}> {
  const view = parseMentionQueueView(params?.view);
  const db = getDb();
  const stats = await getContactMentionStats();

  const filters =
    view === "provisional"
      ? [eq(contactMentions.resolutionStatus, "provisional")]
      : view === "thread_participant"
        ? [
            eq(contactMentions.resolutionStatus, "confirmed"),
            eq(contactMentions.resolutionReason, "thread_participant"),
          ]
        : [eq(contactMentions.resolutionStatus, "unresolved")];

  const limit =
    view === "thread_participant"
      ? THREAD_PARTICIPANT_SAMPLE_LIMIT
      : UNRESOLVED_LOAD_LIMIT;

  const rows = await db
    .select({
      id: contactMentions.id,
      firstName: contactMentions.firstName,
      lastName: contactMentions.lastName,
      email: contactMentions.email,
      phone: contactMentions.phone,
      rawCompany: contactMentions.rawCompany,
      jobTitle: contactMentions.jobTitle,
      mentionKind: contactMentions.mentionKind,
      firstNameKey: contactMentions.firstNameKey,
      firstOrgKey: contactMentions.firstOrgKey,
      fingerprint: contactMentions.fingerprint,
      resolutionStatus: contactMentions.resolutionStatus,
      resolutionReason: contactMentions.resolutionReason,
      resolvedPersonId: contactMentions.resolvedPersonId,
      sourceEmailId: contactMentions.sourceEmailId,
      threadId: emails.threadId,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      bodyText: emails.bodyText,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(contactMentions)
    .leftJoin(emails, eq(contactMentions.sourceEmailId, emails.id))
    .where(and(...filters))
    .orderBy(desc(emails.receivedAt))
    .limit(limit);

  const queueRows: MentionQueueRow[] = rows.map((row) => {
    const terms = mentionContextTerms(row);
    const contextSnippet =
      extractMentionContextSnippet(mentionSearchBody(row), terms) ??
      extractMentionContextSnippet(row.bodyText ?? "", terms) ??
      extractMentionContextSnippet(row.subject ?? "", terms);
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      rawCompany: row.rawCompany,
      jobTitle: row.jobTitle,
      mentionKind: mentionKindFromDb(row.mentionKind),
      firstNameKey: row.firstNameKey,
      firstOrgKey: row.firstOrgKey,
      fingerprint: row.fingerprint,
      resolutionStatus: statusFromDb(row.resolutionStatus),
      resolutionReason: row.resolutionReason,
      resolvedPersonId: row.resolvedPersonId,
      sourceEmailId: row.sourceEmailId,
      threadId: row.threadId,
      subject: row.subject,
      receivedAt: row.receivedAt,
      fromAddress: row.fromAddress,
      toAddresses: row.toAddresses,
      contextSnippet,
    };
  });

  const visibleRows = queueRows.filter((row, index) => {
    const source = rows[index];
    if (!source?.sourceEmailId) return true;
    return mentionCardAppearsInEmail(
      {
        first_name: row.firstName,
        last_name: row.lastName,
        email: row.email,
        phone: row.phone,
        job_title: row.jobTitle,
      },
      {
        subject: source.subject,
        bodyText: source.bodyText,
        bodyTextUnique: source.bodyTextUnique,
        bodyTextStrictUnique: source.bodyTextStrictUnique,
        fromAddress: source.fromAddress,
        toAddresses: source.toAddresses,
        ccAddresses: source.ccAddresses,
      },
    );
  });

  const people = await loadContactRegistryPersons({
    limit: 8000,
    skipVerifiedMentions: true,
  });

  const nameById = new Map(
    people.map((person) => [person.id, personDisplayName(person)]),
  );
  const groups = buildMentionQueueGroups(
    rowsForMentionQueueView(visibleRows, view),
    people.map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      displayName: personDisplayName(person),
      sourceEmailCount: person.sourceEmailCount,
      currentOrganizationName: person.currentOrganizationName,
    })),
  );
  for (const group of groups) {
    for (const sample of group.samples) {
      if (!sample.resolvedPersonId) continue;
      sample.resolvedPersonName =
        nameById.get(sample.resolvedPersonId) ?? null;
    }
  }

  return { view, groups, stats };
}

export async function attachUnresolvedMentionGroup(params: {
  groupId: string;
  personId: string;
  /** When set, only these unresolved mentions in the group are confirmed. */
  mentionIds?: string[] | null;
}): Promise<
  | { ok: true; attached: number; personId: string; displayName: string }
  | { ok: false; error: string }
> {
  const ref = parseMentionQueueGroupId(params.groupId);
  if (!ref) return { ok: false, error: "Invalid mention group." };

  const personId = params.personId.trim();
  if (!personId) return { ok: false, error: "Pick a person to attach to." };

  const db = getDb();
  const [person] = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
    })
    .from(contactPersons)
    .where(eq(contactPersons.id, personId))
    .limit(1);
  if (!person) return { ok: false, error: "Person not found." };

  const matches = await db
    .select({
      id: contactMentions.id,
      firstName: contactMentions.firstName,
      lastName: contactMentions.lastName,
      email: contactMentions.email,
      rawCompany: contactMentions.rawCompany,
      firstNameKey: contactMentions.firstNameKey,
      firstOrgKey: contactMentions.firstOrgKey,
      fingerprint: contactMentions.fingerprint,
    })
    .from(contactMentions)
    .where(eq(contactMentions.resolutionStatus, "unresolved"));

  const groupMatches = matches.filter((row) =>
    mentionMatchesQueueGroup(row, ref),
  );

  if (groupMatches.length === 0) {
    return { ok: false, error: "No unresolved mentions in that group." };
  }

  const ids = filterAttachMentionIds(
    groupMatches.map((row) => row.id),
    params.mentionIds,
  );
  if (ids.length === 0) {
    return {
      ok: false,
      error: "None of the selected mentions are in this unresolved group.",
    };
  }

  await confirmUnresolvedMentionIds({
    ids,
    personId,
    reason: "manual_attach",
  });

  return {
    ok: true,
    attached: ids.length,
    personId,
    displayName: personDisplayName(person),
  };
}

async function confirmUnresolvedMentionIds(params: {
  ids: string[];
  personId: string;
  reason: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  for (let i = 0; i < params.ids.length; i += 400) {
    await db
      .update(contactMentions)
      .set({
        resolutionStatus: "confirmed",
        resolvedPersonId: params.personId,
        resolutionReason: params.reason,
        updatedAt: now,
      })
      .where(inArray(contactMentions.id, params.ids.slice(i, i + 400)));
  }
}

/**
 * Mint a People card from an unresolved first+last mention group (ingest leak).
 * If exactly one existing person already has that name, attach instead.
 */
export async function createPersonFromUnresolvedMentionGroup(params: {
  groupId: string;
  mentionIds?: string[] | null;
}): Promise<
  | {
      ok: true;
      created: boolean;
      attached: number;
      personId: string;
      displayName: string;
    }
  | { ok: false; error: string }
> {
  const ref = parseMentionQueueGroupId(params.groupId);
  if (!ref) return { ok: false, error: "Invalid mention group." };
  if (ref.kind !== "first_last") {
    return {
      ok: false,
      error: "Only full-name mention groups can create a person.",
    };
  }

  const db = getDb();
  const matches = await db
    .select({
      id: contactMentions.id,
      firstName: contactMentions.firstName,
      lastName: contactMentions.lastName,
      email: contactMentions.email,
      phone: contactMentions.phone,
      jobTitle: contactMentions.jobTitle,
      rawCompany: contactMentions.rawCompany,
      firstNameKey: contactMentions.firstNameKey,
      firstOrgKey: contactMentions.firstOrgKey,
      fingerprint: contactMentions.fingerprint,
      sourceEmailId: contactMentions.sourceEmailId,
    })
    .from(contactMentions)
    .where(eq(contactMentions.resolutionStatus, "unresolved"));

  const groupMatches = matches.filter((row) =>
    mentionMatchesQueueGroup(row, ref),
  );
  if (groupMatches.length === 0) {
    return { ok: false, error: "No unresolved mentions in that group." };
  }

  const ids = filterAttachMentionIds(
    groupMatches.map((row) => row.id),
    params.mentionIds,
  );
  if (ids.length === 0) {
    return {
      ok: false,
      error: "None of the selected mentions are in this unresolved group.",
    };
  }

  const selected = groupMatches.filter((row) => ids.includes(row.id));
  const card = pickRichestMentionCard(selected);
  if (!card?.first_name || !card.last_name) {
    return { ok: false, error: "Selected mentions are missing a full name." };
  }

  const people = await loadContactRegistryPersons({
    limit: 8000,
    skipVerifiedMentions: true,
  });
  const firstKey = mentionMatchingFirstNameKey(card.first_name);
  const existing = people.filter(
    (person) =>
      !person.sparseStub &&
      firstKey != null &&
      mentionMatchingFirstNameKey(person.firstName) === firstKey &&
      Boolean(person.lastName?.trim()) &&
      lastNamesCompatible(card.last_name, person.lastName),
  );
  if (existing.length > 1) {
    return {
      ok: false,
      error:
        "Several people already have this name. Attach to one of them instead of creating another card.",
    };
  }
  if (existing.length === 1) {
    const person = existing[0]!;
    await confirmUnresolvedMentionIds({
      ids,
      personId: person.id,
      reason: "manual_attach",
    });
    return {
      ok: true,
      created: false,
      attached: ids.length,
      personId: person.id,
      displayName: personDisplayName(person),
    };
  }

  const emailIds = [
    ...new Set(
      selected
        .map((row) => row.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const dateByEmailId = new Map<string, string | null>();
  if (emailIds.length > 0) {
    const emailRows = await db
      .select({ id: emails.id, receivedAt: emails.receivedAt })
      .from(emails)
      .where(inArray(emails.id, emailIds));
    for (const row of emailRows) {
      dateByEmailId.set(row.id, row.receivedAt);
    }
  }
  const dates = [...dateByEmailId.values()]
    .filter((value): value is string => Boolean(value))
    .sort();
  const evidence = emailIds.map((emailId) => ({
    emailId,
    receivedAt: dateByEmailId.get(emailId) ?? null,
  }));

  const personId = await createPersonFromCard({
    card: {
      first_name: card.first_name,
      last_name: card.last_name,
      email: card.email,
      phone: card.phone,
      job_title: card.job_title,
      raw_company: card.raw_company,
    },
    mentionWeight: Math.max(1, emailIds.length),
    evidence,
    dateMin: dates[0] ?? null,
    dateMax: dates[dates.length - 1] ?? null,
  });

  await confirmUnresolvedMentionIds({
    ids,
    personId,
    reason: "manual_create_from_full_name",
  });

  return {
    ok: true,
    created: true,
    attached: ids.length,
    personId,
    displayName: personDisplayName({
      firstName: card.first_name,
      lastName: card.last_name,
    }),
  };
}
