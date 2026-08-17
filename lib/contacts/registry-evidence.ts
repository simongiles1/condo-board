/** Load contact-registry attribute / person evidence emails for the side panel. */

import { desc, eq, inArray } from "drizzle-orm";

import {
  buildPersonNameNeedles,
  findPersonNameAnchorRanges,
  textHasPersonAnchoredMention,
  type PersonNameParts,
} from "@/lib/contacts/person-anchored-highlight";
import type {
  ContactEvidenceEmailSummary,
  ContactEvidenceKind,
  ContactEvidenceMatchReason,
  ContactEvidencePayload,
  ContactEvidenceScope,
} from "@/lib/contacts/registry-evidence-shared";
import {
  CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  CONTACT_EVIDENCE_MAX_PAGE_SIZE,
  bodyPreviewAroundMention,
  hasContentMatch,
} from "@/lib/contacts/registry-evidence-shared";
import {
  parseEvidenceJson,
  parseIncomingCardSourceEmailIds,
  personDisplayName,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactMergeProposals,
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
  emails,
} from "@/lib/db/schema";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";
import type { ContactHighlightType } from "@/lib/email-analysis/contact-highlight-shared";

export type {
  ContactEvidenceEmailSummary,
  ContactEvidenceKind,
  ContactEvidenceMatchReason,
  ContactEvidencePayload,
  ContactEvidenceScope,
} from "@/lib/contacts/registry-evidence-shared";

export {
  CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  CONTACT_EVIDENCE_MAX_PAGE_SIZE,
  bodyPreviewAroundMention,
  hasContentMatch,
  isContentMatchReason,
  isParticipationMatchReason,
  matchReasonLabel,
} from "@/lib/contacts/registry-evidence-shared";

export type LoadContactEvidenceOptions = {
  scope?: ContactEvidenceScope;
  page?: number;
  pageSize?: number;
};

function normalizeEvidencePaging(options?: LoadContactEvidenceOptions): {
  scope: ContactEvidenceScope;
  page: number;
  pageSize: number;
} {
  const rawPage = options?.page ?? 1;
  const rawSize = options?.pageSize ?? CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    CONTACT_EVIDENCE_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(rawSize) || CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE),
  );
  const page = Math.max(1, Math.floor(rawPage) || 1);
  return {
    scope: options?.scope === "all" ? "all" : "content",
    page,
    pageSize,
  };
}

function paginateEvidenceEmails(
  kept: ContactEvidenceEmailSummary[],
  params: {
    scope: ContactEvidenceScope;
    page: number;
    pageSize: number;
    /** Attribute evidence ignores content/participation split. */
    applyScopeFilter: boolean;
  },
): Pick<
  ContactEvidencePayload,
  | "emails"
  | "scope"
  | "matchedCount"
  | "contentCount"
  | "participationOnlyCount"
  | "page"
  | "pageSize"
  | "totalPages"
> {
  const contentCount = kept.filter((row) =>
    hasContentMatch(row.matchReasons),
  ).length;
  const participationOnlyCount = kept.filter(
    (row) => !hasContentMatch(row.matchReasons),
  ).length;

  const scoped =
    params.applyScopeFilter && params.scope === "content"
      ? kept.filter((row) => hasContentMatch(row.matchReasons))
      : kept;

  const matchedCount = scoped.length;
  const totalPages = Math.max(1, Math.ceil(matchedCount / params.pageSize));
  const page = Math.min(params.page, totalPages);
  const start = (page - 1) * params.pageSize;

  return {
    emails: scoped.slice(start, start + params.pageSize),
    scope: params.applyScopeFilter ? params.scope : "all",
    matchedCount,
    contentCount,
    participationOnlyCount,
    page,
    pageSize: params.pageSize,
    totalPages,
  };
}

function emptyEvidencePaging(
  scope: ContactEvidenceScope,
  pageSize: number,
): Pick<
  ContactEvidencePayload,
  | "emails"
  | "scope"
  | "matchedCount"
  | "contentCount"
  | "participationOnlyCount"
  | "page"
  | "pageSize"
  | "totalPages"
> {
  return {
    emails: [],
    scope,
    matchedCount: 0,
    contentCount: 0,
    participationOnlyCount: 0,
    page: 1,
    pageSize,
    totalPages: 1,
  };
}

type AttributeEvidenceKind = Exclude<ContactEvidenceKind, "person">;

function mentionTypeForKind(kind: ContactEvidenceKind): ContactHighlightType {
  if (kind === "title") return "job_title";
  if (kind === "phone") return "phone";
  return "contact_name";
}

/** Needles for the earliest content hit used in list previews. */
function contentPreviewNeedlesForPerson(params: {
  matchReasons: ContactEvidenceMatchReason[];
  person: PersonNameParts;
  displayName: string;
  attributes: PersonAttributeValues;
}): string[] {
  const needles: string[] = [];
  if (params.matchReasons.includes("name_in_body")) {
    needles.push(...buildPersonNameNeedles(params.person));
    const display = params.displayName.trim();
    if (display && display.toLowerCase() !== "unknown contact") {
      needles.push(display);
    }
  }
  if (params.matchReasons.includes("email_in_body")) {
    needles.push(...params.attributes.emails);
  }
  if (params.matchReasons.includes("phone_in_body")) {
    needles.push(...params.attributes.phones);
  }
  if (params.matchReasons.includes("title_in_body")) {
    needles.push(...params.attributes.titles);
  }
  return needles;
}

function contentPreviewNeedlesForAttribute(params: {
  kind: AttributeEvidenceKind;
  attributeValue: string;
  matchReasons: ContactEvidenceMatchReason[];
}): string[] {
  if (!hasContentMatch(params.matchReasons)) return [];
  return [params.attributeValue];
}

async function loadAttributeRow(params: {
  kind: AttributeEvidenceKind;
  attributeId: string;
}): Promise<{
  personId: string;
  value: string;
  validFrom: string | null;
  validTo: string | null;
  evidenceJson: string;
} | null> {
  const db = getDb();
  if (params.kind === "title") {
    const [row] = await db
      .select()
      .from(contactPersonTitles)
      .where(eq(contactPersonTitles.id, params.attributeId))
      .limit(1);
    if (!row) return null;
    return {
      personId: row.personId,
      value: row.title,
      validFrom: row.validFrom,
      validTo: row.validTo,
      evidenceJson: row.evidenceJson,
    };
  }
  if (params.kind === "phone") {
    const [row] = await db
      .select()
      .from(contactPersonPhones)
      .where(eq(contactPersonPhones.id, params.attributeId))
      .limit(1);
    if (!row) return null;
    return {
      personId: row.personId,
      value: row.phone,
      validFrom: row.validFrom,
      validTo: row.validTo,
      evidenceJson: row.evidenceJson,
    };
  }
  const [row] = await db
    .select()
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.id, params.attributeId))
    .limit(1);
  if (!row) return null;
  return {
    personId: row.personId,
    value: row.email,
    validFrom: row.validFrom,
    validTo: row.validTo,
    evidenceJson: row.evidenceJson,
  };
}

/** Collect source email ids from attributes + ingest proposals for a person. */
export async function collectPersonEvidenceEmailIds(
  personId: string,
): Promise<string[]> {
  const byPerson = await collectCandidateEmailIdsByPersonIds([personId]);
  return [...(byPerson.get(personId) ?? new Set<string>())];
}

/** Batch: candidate source email ids per person (before authored-text filter). */
export async function collectCandidateEmailIdsByPersonIds(
  personIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (personIds.length === 0) return result;

  const db = getDb();
  const [emailRows, phoneRows, titleRows, proposals] = await Promise.all([
    db
      .select({
        personId: contactPersonEmails.personId,
        evidenceJson: contactPersonEmails.evidenceJson,
      })
      .from(contactPersonEmails)
      .where(inArray(contactPersonEmails.personId, personIds)),
    db
      .select({
        personId: contactPersonPhones.personId,
        evidenceJson: contactPersonPhones.evidenceJson,
      })
      .from(contactPersonPhones)
      .where(inArray(contactPersonPhones.personId, personIds)),
    db
      .select({
        personId: contactPersonTitles.personId,
        evidenceJson: contactPersonTitles.evidenceJson,
      })
      .from(contactPersonTitles)
      .where(inArray(contactPersonTitles.personId, personIds)),
    db
      .select({
        resultPersonId: contactMergeProposals.resultPersonId,
        incomingCardJson: contactMergeProposals.incomingCardJson,
      })
      .from(contactMergeProposals)
      .where(inArray(contactMergeProposals.resultPersonId, personIds)),
  ]);

  function add(personId: string, emailId: string) {
    const set = result.get(personId) ?? new Set<string>();
    set.add(emailId);
    result.set(personId, set);
  }

  for (const row of [...emailRows, ...phoneRows, ...titleRows]) {
    for (const item of parseEvidenceJson(row.evidenceJson)) {
      if (item.emailId?.trim()) add(row.personId, item.emailId);
    }
  }

  for (const proposal of proposals) {
    if (!proposal.resultPersonId) continue;
    for (const emailId of parseIncomingCardSourceEmailIds(
      proposal.incomingCardJson,
    )) {
      add(proposal.resultPersonId, emailId);
    }
  }

  return result;
}

type PersonMentionSubject = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

type EvidenceEmailRow = {
  id: string;
  threadId: string | null;
  subject: string;
  fromAddress: string;
  toAddresses: string | null;
  ccAddresses: string | null;
  receivedAt: string;
  bodyText: string;
  bodyHtml: string | null;
  bodyTextUnique: string | null;
};

function personMentionContext(person: PersonMentionSubject) {
  const personParts: PersonNameParts = {
    firstName: person.firstName,
    lastName: person.lastName,
  };
  const hasName = Boolean(
    person.firstName?.trim() || person.lastName?.trim(),
  );
  const displayName = personDisplayName({
    firstName: person.firstName,
    lastName: person.lastName,
  });
  return { personParts, hasName, displayName };
}

function emailRowMatchesPersonMention(
  person: PersonMentionSubject,
  row: EvidenceEmailRow,
  authoredById: Map<string, string>,
): boolean {
  const { personParts, hasName, displayName } = personMentionContext(person);
  const authored = authoredById.get(row.id) ?? row.bodyText;
  return evidenceMessageMatchesPerson({
    hasName,
    person: personParts,
    searchText: authored,
    displayName,
  });
}

type PersonAttributeValues = {
  emails: string[];
  phones: string[];
  titles: string[];
};

/**
 * Classify why a message evidences this person (name / attributes / headers).
 * Empty array = no evidence.
 */
export function classifyPersonEvidenceMatch(params: {
  person: PersonNameParts;
  displayName: string;
  hasName: boolean;
  searchText: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  attributes: PersonAttributeValues;
}): ContactEvidenceMatchReason[] {
  const reasons: ContactEvidenceMatchReason[] = [];

  if (
    evidenceMessageMatchesPerson({
      hasName: params.hasName,
      person: params.person,
      searchText: params.searchText,
      displayName: params.displayName,
    })
  ) {
    reasons.push("name_in_body");
  }

  const searchLower = params.searchText.toLowerCase();
  const fromLower = params.fromAddress.toLowerCase();
  const toLower = params.toAddresses.map((a) => a.toLowerCase());
  const ccLower = params.ccAddresses.map((a) => a.toLowerCase());

  for (const email of params.attributes.emails) {
    const value = email.trim().toLowerCase();
    if (!value) continue;
    if (fromLower.includes(value)) reasons.push("email_from");
    if (toLower.some((a) => a.includes(value))) reasons.push("email_to");
    if (ccLower.some((a) => a.includes(value))) reasons.push("email_cc");
    if (searchLower.includes(value)) reasons.push("email_in_body");
  }

  for (const phone of params.attributes.phones) {
    if (
      evidenceMessageMatchesAttribute({
        kind: "phone",
        attributeValue: phone,
        hasName: params.hasName,
        person: params.person,
        searchText: params.searchText,
        fromAddress: params.fromAddress,
        toAddresses: params.toAddresses,
        ccAddresses: params.ccAddresses,
      })
    ) {
      reasons.push("phone_in_body");
    }
  }

  for (const title of params.attributes.titles) {
    if (
      evidenceMessageMatchesAttribute({
        kind: "title",
        attributeValue: title,
        hasName: params.hasName,
        person: params.person,
        searchText: params.searchText,
        fromAddress: params.fromAddress,
        toAddresses: params.toAddresses,
        ccAddresses: params.ccAddresses,
      })
    ) {
      reasons.push("title_in_body");
    }
  }

  return [...new Set(reasons)];
}

/**
 * True when this message evidences the person via name-in-authored-text OR
 * any linked email/phone/title attribute (same filters as the evidence panels).
 * Email-only identities (CC/From, mailbox stubs) must still count.
 */
export function evidenceMessageMatchesPersonOrAttributes(params: {
  person: PersonNameParts;
  displayName: string;
  hasName: boolean;
  searchText: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  attributes: PersonAttributeValues;
}): boolean {
  return classifyPersonEvidenceMatch(params).length > 0;
}

/** Classify attribute evidence (email header vs body; phone/title body). */
export function classifyAttributeEvidenceMatch(params: {
  kind: AttributeEvidenceKind;
  attributeValue: string;
  hasName: boolean;
  person: PersonNameParts;
  searchText: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
}): ContactEvidenceMatchReason[] {
  if (
    !evidenceMessageMatchesAttribute({
      kind: params.kind,
      attributeValue: params.attributeValue,
      hasName: params.hasName,
      person: params.person,
      searchText: params.searchText,
      fromAddress: params.fromAddress,
      toAddresses: params.toAddresses,
      ccAddresses: params.ccAddresses,
    })
  ) {
    return [];
  }

  if (params.kind === "phone") return ["phone_in_body"];
  if (params.kind === "title") return ["title_in_body"];

  const value = params.attributeValue.trim().toLowerCase();
  if (!value) return [];
  const reasons: ContactEvidenceMatchReason[] = [];
  if (params.fromAddress.toLowerCase().includes(value)) {
    reasons.push("email_from");
  }
  if (
    params.toAddresses.some((a) => a.toLowerCase().includes(value))
  ) {
    reasons.push("email_to");
  }
  if (
    params.ccAddresses.some((a) => a.toLowerCase().includes(value))
  ) {
    reasons.push("email_cc");
  }
  if (params.searchText.toLowerCase().includes(value)) {
    reasons.push("email_in_body");
  }
  return reasons;
}

async function loadAttributeValuesByPersonIds(
  personIds: string[],
): Promise<Map<string, PersonAttributeValues>> {
  const result = new Map<string, PersonAttributeValues>();
  if (personIds.length === 0) return result;

  for (const id of personIds) {
    result.set(id, { emails: [], phones: [], titles: [] });
  }

  const db = getDb();
  const [emailRows, phoneRows, titleRows] = await Promise.all([
    db
      .select({
        personId: contactPersonEmails.personId,
        email: contactPersonEmails.email,
      })
      .from(contactPersonEmails)
      .where(inArray(contactPersonEmails.personId, personIds)),
    db
      .select({
        personId: contactPersonPhones.personId,
        phone: contactPersonPhones.phone,
      })
      .from(contactPersonPhones)
      .where(inArray(contactPersonPhones.personId, personIds)),
    db
      .select({
        personId: contactPersonTitles.personId,
        title: contactPersonTitles.title,
      })
      .from(contactPersonTitles)
      .where(inArray(contactPersonTitles.personId, personIds)),
  ]);

  for (const row of emailRows) {
    result.get(row.personId)?.emails.push(row.email);
  }
  for (const row of phoneRows) {
    result.get(row.personId)?.phones.push(row.phone);
  }
  for (const row of titleRows) {
    result.get(row.personId)?.titles.push(row.title);
  }
  return result;
}

/**
 * Distinct emails where this person's name appears in unique authored text.
 * List "mentions" count — content only, not header participation.
 */
export async function countVerifiedPersonMentionEmailsByPersonId(
  persons: PersonMentionSubject[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (persons.length === 0) return counts;

  const personIds = persons.map((p) => p.id);
  const candidatesByPerson = await collectCandidateEmailIdsByPersonIds(personIds);
  const allEmailIds = new Set<string>();
  for (const set of candidatesByPerson.values()) {
    for (const emailId of set) allEmailIds.add(emailId);
  }

  for (const person of persons) {
    counts.set(person.id, 0);
  }
  if (allEmailIds.size === 0) return counts;

  const db = getDb();
  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, [...allEmailIds]));

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const authoredById = await resolveAuthoredBodiesForEvidence(rows);

  for (const person of persons) {
    const candidateIds = candidatesByPerson.get(person.id);
    if (!candidateIds || candidateIds.size === 0) continue;
    let count = 0;
    for (const emailId of candidateIds) {
      const row = rowById.get(emailId);
      if (!row) continue;
      if (emailRowMatchesPersonMention(person, row, authoredById)) {
        count += 1;
      }
    }
    counts.set(person.id, count);
  }

  return counts;
}

/**
 * Prefer live thread-unique authored text so quoted reply history (e.g. an
 * earlier signature with this title) does not count as evidence for later
 * messages in the same thread.
 */
export async function resolveAuthoredBodiesForEvidence(
  rows: Array<{
    id: string;
    threadId: string | null;
    bodyText: string;
    bodyTextUnique: string | null;
    bodyTextStrictUnique?: string | null;
    receivedAt: string;
    bodyHtml?: string | null;
  }>,
): Promise<Map<string, string>> {
  const authored = new Map<string, string>();

  for (const row of rows) {
    const stored = row.bodyTextStrictUnique?.trim();
    if (stored) {
      authored.set(row.id, stored);
    }
  }

  const needsCompute = rows.filter((row) => !authored.has(row.id));
  if (needsCompute.length === 0) return authored;

  const db = getDb();
  const threadIds = [
    ...new Set(needsCompute.map((r) => r.threadId).filter(Boolean)),
  ] as string[];

  const threadMessages =
    threadIds.length > 0
      ? await db
          .select({
            id: emails.id,
            threadId: emails.threadId,
            bodyText: emails.bodyText,
            bodyHtml: emails.bodyHtml,
            bodyTextStrictUnique: emails.bodyTextStrictUnique,
            receivedAt: emails.receivedAt,
          })
          .from(emails)
          .where(inArray(emails.threadId, threadIds))
      : [];

  const byThread = new Map<string, typeof threadMessages>();
  for (const msg of threadMessages) {
    if (!msg.threadId) continue;
    const list = byThread.get(msg.threadId) ?? [];
    list.push(msg);
    byThread.set(msg.threadId, list);
  }

  const needsComputeIds = new Set(needsCompute.map((row) => row.id));

  for (const [, messages] of byThread) {
    const toCompute = messages.filter(
      (m) => needsComputeIds.has(m.id) && !m.bodyTextStrictUnique?.trim(),
    );
    if (toCompute.length === 0) {
      for (const msg of messages) {
        if (!needsComputeIds.has(msg.id)) continue;
        const stored = msg.bodyTextStrictUnique?.trim();
        if (stored) authored.set(msg.id, stored);
      }
      continue;
    }

    const uniqueMap = computeThreadUniqueBodies(
      messages.map((m) => ({
        id: m.id,
        bodyText: m.bodyText,
        bodyHtml: m.bodyHtml,
        receivedAt: m.receivedAt,
      })),
    );
    for (const msg of messages) {
      if (!needsComputeIds.has(msg.id)) continue;
      const stored = msg.bodyTextStrictUnique?.trim();
      if (stored) {
        authored.set(msg.id, stored);
        continue;
      }
      const unique = uniqueMap.get(msg.id)?.trim();
      if (unique) authored.set(msg.id, unique);
    }
  }

  for (const row of needsCompute) {
    if (authored.has(row.id)) continue;
    const stored = row.bodyTextStrictUnique?.trim();
    if (stored) {
      authored.set(row.id, stored);
      continue;
    }
    const legacy = row.bodyTextUnique?.trim();
    if (legacy) {
      authored.set(row.id, legacy);
      continue;
    }
    const uniqueMap = computeThreadUniqueBodies([
      {
        id: row.id,
        bodyText: row.bodyText,
        bodyHtml: row.bodyHtml ?? null,
        receivedAt: row.receivedAt,
      },
    ]);
    authored.set(row.id, uniqueMap.get(row.id)?.trim() || row.bodyText);
  }

  return authored;
}

/**
 * List evidence emails for a registry attribute, filtered to messages where
 * the value appears near this person's name in the *authored* body (when a
 * name exists) — not merely in quoted prior-thread history.
 */
export async function loadContactAttributeEvidence(params: {
  kind: AttributeEvidenceKind;
  attributeId: string;
  page?: number;
  pageSize?: number;
}): Promise<ContactEvidencePayload | null> {
  const paging = normalizeEvidencePaging({
    scope: "all",
    page: params.page,
    pageSize: params.pageSize,
  });
  const attr = await loadAttributeRow(params);
  if (!attr) return null;

  const db = getDb();
  const [person] = await db
    .select()
    .from(contactPersons)
    .where(eq(contactPersons.id, attr.personId))
    .limit(1);
  if (!person) return null;

  const personParts: PersonNameParts = {
    firstName: person.firstName,
    lastName: person.lastName,
  };
  const hasName = Boolean(
    person.firstName?.trim() || person.lastName?.trim(),
  );

  const evidence = parseEvidenceJson(attr.evidenceJson);
  const emailIds = [...new Set(evidence.map((e) => e.emailId))];
  const personBlock = {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName: personDisplayName({
      firstName: person.firstName,
      lastName: person.lastName,
      emails: [{ email: attr.value }],
    }),
  };

  if (emailIds.length === 0) {
    return {
      kind: params.kind,
      attributeId: params.attributeId,
      value: attr.value,
      mentionType: mentionTypeForKind(params.kind),
      person: personBlock,
      validFrom: attr.validFrom,
      validTo: attr.validTo,
      omittedCount: 0,
      ...emptyEvidencePaging("all", paging.pageSize),
    };
  }

  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, emailIds))
    .orderBy(desc(emails.receivedAt));

  const foundIds = new Set(rows.map((r) => r.id));
  let omittedCount = emailIds.filter((id) => !foundIds.has(id)).length;

  const authoredById = await resolveAuthoredBodiesForEvidence(rows);

  const kept: ContactEvidenceEmailSummary[] = [];
  for (const row of rows) {
    const searchText = authoredById.get(row.id) ?? row.bodyText;
    const matchReasons = classifyAttributeEvidenceMatch({
      kind: params.kind,
      attributeValue: attr.value,
      hasName,
      person: personParts,
      searchText,
      fromAddress: row.fromAddress,
      toAddresses: parseAddressList(row.toAddresses),
      ccAddresses: parseAddressList(row.ccAddresses),
    });

    if (matchReasons.length === 0) {
      omittedCount += 1;
      continue;
    }

    kept.push({
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: bodyPreviewAroundMention({
        text: searchText,
        needles: contentPreviewNeedlesForAttribute({
          kind: params.kind,
          attributeValue: attr.value,
          matchReasons,
        }),
      }),
      hasAnchoredMention: hasContentMatch(matchReasons),
      matchReasons,
    });
  }

  return {
    kind: params.kind,
    attributeId: params.attributeId,
    value: attr.value,
    mentionType: mentionTypeForKind(params.kind),
    person: personBlock,
    validFrom: attr.validFrom,
    validTo: attr.validTo,
    omittedCount,
    ...paginateEvidenceEmails(kept, {
      scope: "all",
      page: paging.page,
      pageSize: paging.pageSize,
      applyScopeFilter: false,
    }),
  };
}

/**
 * Name-only (and any) people: open mention evidence even when they have no
 * email/phone/title rows. Source ids come from attribute evidence plus the
 * ingest proposals that created/enriched this person.
 */
export async function loadContactPersonEvidence(
  personId: string,
  options?: LoadContactEvidenceOptions,
): Promise<ContactEvidencePayload | null> {
  const paging = normalizeEvidencePaging({
    scope: options?.scope ?? "content",
    page: options?.page,
    pageSize: options?.pageSize,
  });
  const db = getDb();
  const [person] = await db
    .select()
    .from(contactPersons)
    .where(eq(contactPersons.id, personId))
    .limit(1);
  if (!person) return null;

  const displayName = personDisplayName({
    firstName: person.firstName,
    lastName: person.lastName,
  });

  const personBlock = {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName,
  };

  const emailIds = await collectPersonEvidenceEmailIds(personId);
  if (emailIds.length === 0) {
    return {
      kind: "person",
      attributeId: personId,
      value: displayName,
      mentionType: "contact_name",
      person: personBlock,
      validFrom: null,
      validTo: null,
      omittedCount: 0,
      ...emptyEvidencePaging(paging.scope, paging.pageSize),
    };
  }

  const attributesByPerson = await loadAttributeValuesByPersonIds([personId]);
  const attributes = attributesByPerson.get(personId) ?? {
    emails: [],
    phones: [],
    titles: [],
  };
  const subject: PersonMentionSubject = {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
  };
  const { personParts, hasName } = personMentionContext(subject);

  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, emailIds))
    .orderBy(desc(emails.receivedAt));

  const foundIds = new Set(rows.map((r) => r.id));
  let omittedCount = emailIds.filter((id) => !foundIds.has(id)).length;

  const authoredById = await resolveAuthoredBodiesForEvidence(rows);

  const kept: ContactEvidenceEmailSummary[] = [];
  for (const row of rows) {
    const authored = authoredById.get(row.id) ?? row.bodyText;
    const matchReasons = classifyPersonEvidenceMatch({
      person: personParts,
      displayName,
      hasName,
      searchText: authored,
      fromAddress: row.fromAddress,
      toAddresses: parseAddressList(row.toAddresses),
      ccAddresses: parseAddressList(row.ccAddresses),
      attributes,
    });
    if (matchReasons.length === 0) {
      omittedCount += 1;
      continue;
    }
    kept.push({
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: bodyPreviewAroundMention({
        text: authored,
        needles: contentPreviewNeedlesForPerson({
          matchReasons,
          person: personParts,
          displayName,
          attributes,
        }),
      }),
      hasAnchoredMention: hasContentMatch(matchReasons),
      matchReasons,
    });
  }

  return {
    kind: "person",
    attributeId: personId,
    value: displayName,
    mentionType: "contact_name",
    person: personBlock,
    validFrom: null,
    validTo: null,
    omittedCount,
    ...paginateEvidenceEmails(kept, {
      scope: paging.scope,
      page: paging.page,
      pageSize: paging.pageSize,
      applyScopeFilter: true,
    }),
  };
}

export async function loadContactEvidence(params: {
  kind: ContactEvidenceKind;
  id: string;
  scope?: ContactEvidenceScope;
  page?: number;
  pageSize?: number;
}): Promise<ContactEvidencePayload | null> {
  if (params.kind === "person") {
    return loadContactPersonEvidence(params.id, {
      scope: params.scope,
      page: params.page,
      pageSize: params.pageSize,
    });
  }
  return loadContactAttributeEvidence({
    kind: params.kind,
    attributeId: params.id,
    page: params.page,
    pageSize: params.pageSize,
  });
}

function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Titles/phones: person-anchored body hit (or raw includes when nameless).
 * Emails: header participation counts — addresses rarely appear in the body.
 */
export function evidenceMessageMatchesAttribute(params: {
  kind: AttributeEvidenceKind;
  attributeValue: string;
  hasName: boolean;
  person: PersonNameParts;
  searchText: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
}): boolean {
  const value = params.attributeValue.trim();
  if (!value) return false;
  const valueLower = value.toLowerCase();

  if (params.kind === "email") {
    const headerBlob = [
      params.fromAddress,
      ...params.toAddresses,
      ...params.ccAddresses,
    ]
      .join(" ")
      .toLowerCase();
    if (headerBlob.includes(valueLower)) return true;
    return params.searchText.toLowerCase().includes(valueLower);
  }

  if (params.hasName) {
    return textHasPersonAnchoredMention({
      text: params.searchText,
      person: params.person,
      mentionText: value,
    });
  }
  return params.searchText.toLowerCase().includes(valueLower);
}

/** Keep messages where this person's name appears in authored text. */
export function evidenceMessageMatchesPerson(params: {
  hasName: boolean;
  person: PersonNameParts;
  searchText: string;
  displayName: string;
}): boolean {
  if (params.hasName) {
    const last = params.person.lastName?.trim();
    const first = params.person.firstName?.trim();
    // Prefer last / full name so ultra-short firsts (e.g. "J.") do not match noise.
    if (last && last.length >= 2) {
      const needles = [last];
      if (first) {
        needles.push(`${first} ${last}`, `${last}, ${first}`);
      }
      return needles.some(
        (needle) =>
          params.searchText.toLowerCase().includes(needle.toLowerCase()),
      );
    }
    return findPersonNameAnchorRanges(params.searchText, params.person).length > 0;
  }
  const needle = params.displayName.trim().toLowerCase();
  if (!needle || needle === "unknown contact") return false;
  return params.searchText.toLowerCase().includes(needle);
}
