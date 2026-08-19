/**
 * Discrete contact mention resolver + provisional retraction.
 * Triggered after registry ingest and during stub backfill.
 * Also confirms unique first+last and unique full names already in the subject.
 */

import { and, eq, inArray } from "drizzle-orm";

import { companyNameMatchesOrg } from "@/lib/affiliations/matching";
import {
  decideContactMentionResolution,
  personFullNameAppearsInSubject,
  shouldRetractProvisionalMention,
  type MentionResolveCandidate,
} from "@/lib/contacts/mention-resolve-shared";
import { mentionMatchingFirstNameKey } from "@/lib/contacts/mention-shared";
import {
  lastNamesCompatible,
  normalizeGivenNameToken,
} from "@/lib/contacts/person-name";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import {
  normalizeContactRegistryEmail,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactMentions,
  contactPersonEmails,
  contactPersonPhones,
  emails,
} from "@/lib/db/schema";
import { extractMailboxEmail, parseStoredFromAddress } from "@/lib/email/address-display";
import { normalizePhone } from "@/lib/email/entity-dedup";
import { loadActiveOrganizationEntities } from "@/lib/organizations/registry-sync";

export type ResolveContactMentionsResult = {
  scanned: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
  retracted: number;
};

function parseAddressList(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function toCandidate(
  person: ContactRegistryPersonSummary,
): MentionResolveCandidate {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    sourceEmailCount: person.sourceEmailCount,
    mentionWeight: person.mentionWeight,
  };
}

function canonicalPeople(
  persons: ContactRegistryPersonSummary[],
): ContactRegistryPersonSummary[] {
  return persons.filter(
    (person) =>
      !person.sparseStub &&
      Boolean(person.lastName?.trim() || person.emails.length > 0),
  );
}

async function lookupPersonIdByEmail(email: string): Promise<string | null> {
  const key = normalizeContactRegistryEmail(email);
  if (!key) return null;
  const db = getDb();
  const [indexRow] = await db
    .select({ currentPersonId: contactEmailIndex.currentPersonId })
    .from(contactEmailIndex)
    .where(eq(contactEmailIndex.email, key))
    .limit(1);
  if (indexRow?.currentPersonId) return indexRow.currentPersonId;

  const [occupancy] = await db
    .select({ personId: contactPersonEmails.personId })
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.email, key))
    .limit(1);
  return occupancy?.personId ?? null;
}

async function lookupPersonIdByPhone(phone: string): Promise<string | null> {
  const digits = normalizePhone(phone);
  if (digits.length < 7) return null;
  const db = getDb();
  const [row] = await db
    .select({ personId: contactPersonPhones.personId })
    .from(contactPersonPhones)
    .where(eq(contactPersonPhones.phoneNormalized, digits))
    .limit(1);
  return row?.personId ?? null;
}

async function loadParticipantPersonIds(emailId: string): Promise<{
  personIds: Set<string>;
  headerFirsts: Set<string>;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .limit(1);

  const personIds = new Set<string>();
  const headerFirsts = new Set<string>();
  if (!row) return { personIds, headerFirsts };

  const lines = [
    row.fromAddress,
    ...parseAddressList(row.toAddresses),
    ...parseAddressList(row.ccAddresses),
  ];
  for (const line of lines) {
    const parsed = parseStoredFromAddress(line);
    const mailbox =
      (parsed.email ? extractMailboxEmail(parsed.email) : null) ??
      extractMailboxEmail(line);
    if (mailbox) {
      const personId = await lookupPersonIdByEmail(mailbox);
      if (personId) personIds.add(personId);
    }
    const first = parsed.name?.trim().split(/\s+/)[0];
    if (first && first.replace(/\./g, "").length >= 2) {
      headerFirsts.add(normalizeGivenNameToken(first));
    }
  }
  return { personIds, headerFirsts };
}

function personMatchesFirstOrg(
  person: ContactRegistryPersonSummary,
  firstOrgKey: string,
  orgIdsForCompany: Set<string>,
): boolean {
  const first = mentionMatchingFirstNameKey(person.firstName);
  const expectedFirst = firstOrgKey.split("|")[0];
  if (!first || first !== expectedFirst) return false;
  if (person.currentOrganizationId && orgIdsForCompany.has(person.currentOrganizationId)) {
    return true;
  }
  return false;
}

/**
 * Resolve unresolved mentions. When `emailIds` is set, only those source emails.
 */
export async function resolveContactMentions(params?: {
  emailIds?: string[];
  limit?: number;
}): Promise<ResolveContactMentionsResult> {
  const db = getDb();
  const limit = params?.limit ?? 2000;
  const emailIds = params?.emailIds
    ?.map((id) => id.trim())
    .filter(Boolean);

  const mentionRows =
    emailIds && emailIds.length > 0
      ? await db
          .select()
          .from(contactMentions)
          .where(
            and(
              eq(contactMentions.resolutionStatus, "unresolved"),
              inArray(contactMentions.sourceEmailId, emailIds),
            ),
          )
          .limit(limit)
      : await db
          .select()
          .from(contactMentions)
          .where(eq(contactMentions.resolutionStatus, "unresolved"))
          .limit(limit);

  const sourceEmailIds = [
    ...new Set(
      mentionRows
        .map((row) => row.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const subjectByEmailId = new Map<string, string | null>();
  if (sourceEmailIds.length > 0) {
    const subjectRows = await db
      .select({ id: emails.id, subject: emails.subject })
      .from(emails)
      .where(inArray(emails.id, sourceEmailIds));
    for (const row of subjectRows) {
      subjectByEmailId.set(row.id, row.subject);
    }
  }

  const persons = await loadContactRegistryPersons({
    limit: 8000,
    orderByMention: true,
    skipVerifiedMentions: true,
  });
  const byId = new Map(persons.map((person) => [person.id, person]));
  const canonical = canonicalPeople(persons);
  const orgs = await loadActiveOrganizationEntities();

  const result: ResolveContactMentionsResult = {
    scanned: mentionRows.length,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
    retracted: 0,
  };

  const participantCache = new Map<
    string,
    { personIds: Set<string>; headerFirsts: Set<string> }
  >();

  for (const mention of mentionRows) {
    const firstKey =
      mentionMatchingFirstNameKey(mention.firstName) ?? mention.firstNameKey;
    const company = mention.rawCompany;

    let exactEmailId: string | null = null;
    if (mention.email?.trim()) {
      exactEmailId = await lookupPersonIdByEmail(mention.email);
    }
    let exactPhoneId: string | null = null;
    if (mention.phone?.trim()) {
      exactPhoneId = await lookupPersonIdByPhone(mention.phone);
    }

    let participantMatches: MentionResolveCandidate[] = [];
    if (mention.sourceEmailId && firstKey) {
      let participants = participantCache.get(mention.sourceEmailId);
      if (!participants) {
        participants = await loadParticipantPersonIds(mention.sourceEmailId);
        participantCache.set(mention.sourceEmailId, participants);
      }
      participantMatches = [...participants.personIds]
        .map((id) => byId.get(id))
        .filter((person): person is ContactRegistryPersonSummary => Boolean(person))
        .filter((person) => mentionMatchingFirstNameKey(person.firstName) === firstKey)
        .map(toCandidate);
    }

    const orgIdsForCompany = new Set<string>();
    if (company) {
      for (const org of orgs) {
        if (companyNameMatchesOrg(company, org)) orgIdsForCompany.add(org.id);
      }
    }

    const firstOrgMatches =
      mention.firstOrgKey && orgIdsForCompany.size > 0
        ? canonical
            .filter((person) =>
              personMatchesFirstOrg(person, mention.firstOrgKey!, orgIdsForCompany),
            )
            .map(toCandidate)
        : [];

    const firstNameCanonicalMatches = firstKey
      ? canonical
          .filter((person) => mentionMatchingFirstNameKey(person.firstName) === firstKey)
          .map(toCandidate)
      : [];

    const mentionLast = mention.lastName?.trim() || null;
    const firstLastMatches =
      firstKey && mentionLast
        ? canonical
            .filter(
              (person) =>
                mentionMatchingFirstNameKey(person.firstName) === firstKey &&
                Boolean(person.lastName?.trim()) &&
                lastNamesCompatible(mentionLast, person.lastName),
            )
            .map(toCandidate)
        : [];

    const subject = mention.sourceEmailId
      ? (subjectByEmailId.get(mention.sourceEmailId) ?? null)
      : null;
    const subjectNameMatches = firstKey
      ? canonical
          .filter(
            (person) =>
              mentionMatchingFirstNameKey(person.firstName) === firstKey &&
              personFullNameAppearsInSubject({
                firstName: person.firstName,
                lastName: person.lastName,
                subject,
              }),
          )
          .map(toCandidate)
      : [];

    const decision = decideContactMentionResolution({
      exactPersonByEmailId: exactEmailId,
      exactPersonByPhoneId: exactPhoneId,
      participantMatches,
      firstLastMatches,
      subjectNameMatches,
      firstOrgMatches,
      firstNameCanonicalMatches:
        mention.firstOrgKey && firstOrgMatches.length > 0
          ? []
          : firstNameCanonicalMatches,
    });

    const now = new Date().toISOString();
    let resolvedOrganizationId: string | null = mention.resolvedOrganizationId;
    if (orgIdsForCompany.size === 1) {
      resolvedOrganizationId = [...orgIdsForCompany][0] ?? null;
    }

    await db
      .update(contactMentions)
      .set({
        resolutionStatus: decision.status,
        resolvedPersonId: decision.personId,
        resolvedOrganizationId,
        resolutionReason: decision.reason,
        updatedAt: now,
      })
      .where(eq(contactMentions.id, mention.id));

    if (decision.status === "confirmed") result.confirmed += 1;
    else if (decision.status === "provisional") result.provisional += 1;
    else result.unresolved += 1;
  }

  result.retracted = (await retractProvisionalMentions()).retracted;
  return result;
}

/**
 * When two canonical people share a first+org or first-name key, unhook
 * provisionals that were attached under uniqueness.
 */
export async function retractProvisionalMentions(): Promise<{ retracted: number }> {
  const db = getDb();
  const persons = await loadContactRegistryPersons({
    limit: 8000,
    skipVerifiedMentions: true,
  });
  const canonical = canonicalPeople(persons);
  const orgs = await loadActiveOrganizationEntities();

  const firstNameCounts = new Map<string, number>();
  const firstOrgCounts = new Map<string, number>();

  for (const person of canonical) {
    const first = mentionMatchingFirstNameKey(person.firstName);
    if (first) {
      firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
    }
    if (!first || !person.currentOrganizationId) continue;
    const org = orgs.find((row) => row.id === person.currentOrganizationId);
    if (!org?.name) continue;
    const key = `${first}|${org.name
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()}`;
    firstOrgCounts.set(key, (firstOrgCounts.get(key) ?? 0) + 1);
  }

  const collidingFirstNameKeys = new Set(
    [...firstNameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
  const collidingFirstOrgKeys = new Set(
    [...firstOrgCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );

  if (collidingFirstNameKeys.size === 0 && collidingFirstOrgKeys.size === 0) {
    return { retracted: 0 };
  }

  const provisionals = await db
    .select()
    .from(contactMentions)
    .where(eq(contactMentions.resolutionStatus, "provisional"));

  const now = new Date().toISOString();
  let retracted = 0;
  for (const mention of provisionals) {
    if (
      !shouldRetractProvisionalMention({
        reason: mention.resolutionReason,
        firstOrgKey: mention.firstOrgKey,
        firstNameKey: mention.firstNameKey,
        collidingFirstOrgKeys,
        collidingFirstNameKeys,
      })
    ) {
      continue;
    }
    await db
      .update(contactMentions)
      .set({
        resolutionStatus: "unresolved",
        resolvedPersonId: null,
        resolutionReason: "retracted_uniqueness_broken",
        updatedAt: now,
      })
      .where(eq(contactMentions.id, mention.id));
    retracted += 1;
  }

  return { retracted };
}
