/**
 * Group unresolved (and review) contact mentions for the Contacts Mentions tab.
 * Client-safe: no DB.
 */

import {
  type ContactMentionCard,
  type ContactMentionKind,
  type ContactMentionResolutionStatus,
  mentionFirstLastKey,
  mentionHasFullName,
  mentionMatchingFirstNameKey,
  mentionMatchingFirstOrgKey,
} from "@/lib/contacts/mention-shared";
import {
  lastNamesCompatible,
  titleCaseGivenName,
} from "@/lib/contacts/person-name";
import {
  extractMailboxEmail,
  parseStoredFromAddress,
} from "@/lib/email/address-display";

export const MENTION_QUEUE_VIEWS = [
  "unresolved",
  "full_name",
  "provisional",
  "thread_participant",
] as const;

export type MentionQueueView = (typeof MENTION_QUEUE_VIEWS)[number];

export const MENTION_QUEUE_GROUP_KINDS = [
  "first_last",
  "first_org",
  "first_name",
  "email",
  "other",
] as const;

export type MentionQueueGroupKind = (typeof MENTION_QUEUE_GROUP_KINDS)[number];

export type MentionQueueGroupRef = {
  kind: MentionQueueGroupKind;
  key: string;
};

export type MentionQueueRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  rawCompany: string | null;
  jobTitle: string | null;
  rolePhrase: string | null;
  mentionKind: ContactMentionKind;
  firstNameKey: string | null;
  firstOrgKey: string | null;
  fingerprint: string;
  resolutionStatus: ContactMentionResolutionStatus;
  resolutionReason: string | null;
  resolvedPersonId: string | null;
  sourceEmailId: string | null;
  threadId: string | null;
  subject: string | null;
  receivedAt: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  /** ±100 chars around the name in the source email, when found. */
  contextSnippet: string | null;
};

export type MentionQueueSample = {
  mentionId: string;
  sourceEmailId: string | null;
  threadId: string | null;
  subject: string | null;
  receivedAt: string | null;
  fromAddress: string | null;
  toPreview: string | null;
  mentionKind: ContactMentionKind;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  rawCompany: string | null;
  jobTitle: string | null;
  rolePhrase: string | null;
  resolutionReason: string | null;
  resolvedPersonId: string | null;
  resolvedPersonName?: string | null;
  contextSnippet: string | null;
};

export type MentionQueueCandidate = {
  id: string;
  displayName: string;
  sourceEmailCount: number;
  currentOrganizationName: string | null;
};

export type MentionQueueGroup = {
  id: string;
  kind: MentionQueueGroupKind;
  key: string;
  label: string;
  firstName: string | null;
  rawCompany: string | null;
  mentionCount: number;
  emailCount: number;
  participantCount: number;
  referredCount: number;
  samples: MentionQueueSample[];
  candidates: MentionQueueCandidate[];
};

export type ContactMentionStats = {
  total: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
  /** Unresolved mentions that already have first + last (ingest leaks). */
  fullName: number;
};

/** Chars of authored text kept on each side of the matched name. */
export const MENTION_CONTEXT_RADIUS_CHARS = 100;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search terms for locating a mention in email text (longest first). */
export function mentionContextTerms(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string[] {
  const first = row.firstName?.trim() || "";
  const last = row.lastName?.trim() || "";
  const terms: string[] = [];
  if (first && last) {
    terms.push(`${first} ${last}`, `${last}, ${first}`);
  }
  if (first) terms.push(first);
  if (last) terms.push(last);
  const email = row.email?.trim();
  if (email) terms.push(email);
  return terms;
}

/**
 * Collapse whitespace and keep `radius` characters before and after the first
 * whole-token match. Returns null when none of the terms appear.
 */
export function extractMentionContextSnippet(
  text: string,
  terms: Array<string | null | undefined>,
  radius = MENTION_CONTEXT_RADIUS_CHARS,
): string | null {
  const haystack = text.replace(/\s+/g, " ").trim();
  if (!haystack) return null;

  const needles = [
    ...new Set(
      terms
        .map((term) => term?.trim())
        .filter((term): term is string => Boolean(term)),
    ),
  ].sort((a, b) => b.length - a.length);

  for (const needle of needles) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escapeRegExp(needle)})(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    );
    const match = pattern.exec(haystack);
    if (!match || match.index == null) continue;
    const matchStart = match.index + match[1].length;
    const matchLength = match[2].length;
    const start = Math.max(0, matchStart - radius);
    const end = Math.min(haystack.length, matchStart + matchLength + radius);
    let snippet = haystack.slice(start, end);
    if (start > 0) snippet = `…${snippet}`;
    if (end < haystack.length) snippet = `${snippet}…`;
    return snippet;
  }
  return null;
}

/**
 * When `requested` is omitted, attach every id in the group.
 * When provided, keep only ids that actually belong to the group.
 */
export function filterAttachMentionIds(
  groupMentionIds: string[],
  requested: string[] | null | undefined,
): string[] {
  if (requested == null) return [...groupMentionIds];
  const wanted = new Set(
    requested.map((id) => id.trim()).filter(Boolean),
  );
  return groupMentionIds.filter((id) => wanted.has(id));
}

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

function formatAddressLabel(raw: string): string {
  const parsed = parseStoredFromAddress(raw);
  if (parsed.name) return parsed.name;
  return parsed.email ?? extractMailboxEmail(raw) ?? raw;
}

/** Short To-line so a crowded header is visible without opening the email. */
export function formatToLinePreview(
  toAddressesJson: string | null | undefined,
  max = 3,
): string | null {
  const lines = parseAddressList(toAddressesJson);
  if (lines.length === 0) return null;
  const labels = lines.map(formatAddressLabel);
  if (labels.length <= max) return labels.join(", ");
  const extra = labels.length - max;
  return `${labels.slice(0, max).join(", ")} +${extra}`;
}

export type MentionQueueGroupCard = Pick<
  MentionQueueRow,
  | "id"
  | "firstName"
  | "lastName"
  | "email"
  | "rawCompany"
  | "firstNameKey"
  | "firstOrgKey"
  | "fingerprint"
>;

export function mentionQueueGroupRef(
  row: MentionQueueGroupCard,
): MentionQueueGroupRef {
  const firstLast = mentionFirstLastKey({
    firstName: row.firstName,
    lastName: row.lastName,
  });
  if (firstLast) {
    return { kind: "first_last", key: firstLast };
  }
  const firstOrg = mentionMatchingFirstOrgKey({
    firstName: row.firstName,
    rawCompany: row.rawCompany,
  });
  if (firstOrg) {
    return { kind: "first_org", key: firstOrg };
  }
  const first = mentionMatchingFirstNameKey(row.firstName);
  if (first) {
    return { kind: "first_name", key: first };
  }
  const email = row.email?.trim().toLowerCase();
  if (email) {
    return { kind: "email", key: email };
  }
  return { kind: "other", key: row.fingerprint || row.id };
}

export function mentionMatchesQueueGroup(
  row: MentionQueueGroupCard,
  ref: MentionQueueGroupRef,
): boolean {
  const got = mentionQueueGroupRef(row);
  return got.kind === ref.kind && got.key === ref.key;
}

export function mentionQueueGroupId(ref: MentionQueueGroupRef): string {
  return `${ref.kind}:${ref.key}`;
}

export function parseMentionQueueGroupId(
  id: string,
): MentionQueueGroupRef | null {
  const cut = id.indexOf(":");
  if (cut <= 0) return null;
  const kind = id.slice(0, cut);
  const key = id.slice(cut + 1).trim();
  if (!key) return null;
  if (
    kind !== "first_last" &&
    kind !== "first_org" &&
    kind !== "first_name" &&
    kind !== "email" &&
    kind !== "other"
  ) {
    return null;
  }
  return { kind, key };
}

function groupLabel(ref: MentionQueueGroupRef, rows: MentionQueueRow[]): string {
  if (ref.kind === "first_last") {
    const named = rows.find(
      (row) => row.firstName?.trim() && row.lastName?.trim(),
    );
    if (named?.firstName && named.lastName) {
      return [named.firstName.trim(), named.lastName.trim()].join(" ");
    }
    const [firstKey, ...lastParts] = ref.key.split("|");
    const last = lastParts.join("|").trim();
    const first = firstKey ? titleCaseGivenName(firstKey) : "Unknown";
    return last ? `${first} ${titleCaseGivenName(last)}` : first;
  }
  if (ref.kind === "first_org") {
    const [firstKey, ...orgParts] = ref.key.split("|");
    const org = orgParts.join("|").trim();
    const first =
      rows.find((row) => row.firstName?.trim())?.firstName?.trim() ||
      (firstKey ? titleCaseGivenName(firstKey) : "Unknown");
    const company =
      rows.find((row) => row.rawCompany?.trim())?.rawCompany?.trim() || org;
    return company ? `${first} · ${company}` : first;
  }
  if (ref.kind === "first_name") {
    const named = rows.find((row) => row.firstName?.trim())?.firstName?.trim();
    return named || titleCaseGivenName(ref.key) || "Unknown";
  }
  if (ref.kind === "email") return ref.key;
  const named = rows.find(
    (row) => row.firstName?.trim() || row.lastName?.trim() || row.email?.trim(),
  );
  if (named?.firstName || named?.lastName) {
    return [named.firstName, named.lastName].filter(Boolean).join(" ");
  }
  return named?.email || named?.jobTitle || "Unnamed mention";
}

function toSample(row: MentionQueueRow): MentionQueueSample {
  return {
    mentionId: row.id,
    sourceEmailId: row.sourceEmailId,
    threadId: row.threadId,
    subject: row.subject,
    receivedAt: row.receivedAt,
    fromAddress: row.fromAddress,
    toPreview: formatToLinePreview(row.toAddresses),
    mentionKind: row.mentionKind,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    rawCompany: row.rawCompany,
    jobTitle: row.jobTitle,
    rolePhrase: row.rolePhrase,
    resolutionReason: row.resolutionReason,
    resolvedPersonId: row.resolvedPersonId,
    resolvedPersonName: null,
    contextSnippet: row.contextSnippet,
  };
}

function compareReceivedAtDesc(a: MentionQueueRow, b: MentionQueueRow): number {
  const left = a.receivedAt ?? "";
  const right = b.receivedAt ?? "";
  if (left !== right) return right.localeCompare(left);
  return b.id.localeCompare(a.id);
}

export type MentionQueuePersonHint = {
  id: string;
  firstName: string | null;
  displayName: string;
  sourceEmailCount: number;
  currentOrganizationName: string | null;
  lastName?: string | null;
  emails?: Array<{ email: string }>;
};

function toCandidate(person: MentionQueuePersonHint): MentionQueueCandidate {
  return {
    id: person.id,
    displayName: person.displayName,
    sourceEmailCount: person.sourceEmailCount,
    currentOrganizationName: person.currentOrganizationName,
  };
}

function candidatesForGroup(
  ref: MentionQueueGroupRef,
  people: MentionQueuePersonHint[],
  limit = 6,
): MentionQueueCandidate[] {
  const firstKey =
    ref.kind === "first_org" || ref.kind === "first_last"
      ? ref.key.split("|")[0] ?? null
      : ref.kind === "first_name"
        ? ref.key
        : null;
  if (!firstKey) return [];
  const sameFirst = people.filter(
    (person) => mentionMatchingFirstNameKey(person.firstName) === firstKey,
  );
  if (ref.kind === "first_last") {
    const lastKey = ref.key.split("|").slice(1).join("|");
    const sameLast = sameFirst.filter(
      (person) =>
        Boolean(person.lastName?.trim()) &&
        lastNamesCompatible(lastKey, person.lastName),
    );
    const rest = sameFirst.filter(
      (person) => !sameLast.some((hit) => hit.id === person.id),
    );
    const byCount = (a: MentionQueuePersonHint, b: MentionQueuePersonHint) =>
      b.sourceEmailCount - a.sourceEmailCount;
    return [...sameLast.sort(byCount), ...rest.sort(byCount)]
      .slice(0, limit)
      .map(toCandidate);
  }
  return sameFirst
    .sort((a, b) => b.sourceEmailCount - a.sourceEmailCount)
    .slice(0, limit)
    .map(toCandidate);
}

/** Prefer a mention that already has email/phone when minting a person. */
export function pickRichestMentionCard(
  samples: Array<{
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
    rawCompany: string | null;
  }>,
): ContactMentionCard | null {
  let best: ContactMentionCard | null = null;
  let bestScore = -1;
  for (const sample of samples) {
    const card: ContactMentionCard = {
      first_name: sample.firstName?.trim() || null,
      last_name: sample.lastName?.trim() || null,
      email: sample.email?.trim() || null,
      phone: sample.phone?.trim() || null,
      job_title: sample.jobTitle?.trim() || null,
      raw_company: sample.rawCompany?.trim() || null,
    };
    let score = 0;
    if (card.email) score += 4;
    if (card.phone) score += 3;
    if (card.first_name && card.last_name) score += 2;
    if (card.raw_company) score += 1;
    if (card.job_title) score += 1;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

export function rowsForMentionQueueView(
  rows: MentionQueueRow[],
  view: MentionQueueView,
): MentionQueueRow[] {
  if (view === "full_name") {
    return rows.filter((row) => mentionHasFullName(row));
  }
  if (view === "unresolved") {
    return rows.filter((row) => !mentionHasFullName(row));
  }
  return rows;
}

export function buildMentionQueueGroups(
  rows: MentionQueueRow[],
  people: MentionQueuePersonHint[] = [],
): MentionQueueGroup[] {
  const buckets = new Map<string, { ref: MentionQueueGroupRef; rows: MentionQueueRow[] }>();
  for (const row of rows) {
    const ref = mentionQueueGroupRef(row);
    const id = mentionQueueGroupId(ref);
    const bucket = buckets.get(id);
    if (bucket) bucket.rows.push(row);
    else buckets.set(id, { ref, rows: [row] });
  }

  const groups: MentionQueueGroup[] = [];
  for (const { ref, rows: members } of buckets.values()) {
    const emailIds = new Set(
      members.map((row) => row.sourceEmailId).filter((id): id is string => Boolean(id)),
    );
    const sorted = [...members].sort(compareReceivedAtDesc);
    groups.push({
      id: mentionQueueGroupId(ref),
      kind: ref.kind,
      key: ref.key,
      label: groupLabel(ref, members),
      firstName:
        members.find((row) => row.firstName?.trim())?.firstName?.trim() ?? null,
      rawCompany:
        members.find((row) => row.rawCompany?.trim())?.rawCompany?.trim() ?? null,
      mentionCount: members.length,
      emailCount: emailIds.size,
      participantCount: members.filter((row) => row.mentionKind === "participant")
        .length,
      referredCount: members.filter((row) => row.mentionKind === "referred").length,
      samples: sorted.map(toSample),
      candidates: candidatesForGroup(ref, people),
    });
  }

  groups.sort(
    (a, b) =>
      b.mentionCount - a.mentionCount ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
  return groups;
}

export function parseMentionQueueView(
  value: string | null | undefined,
): MentionQueueView {
  if (
    value === "provisional" ||
    value === "thread_participant" ||
    value === "unresolved" ||
    value === "full_name"
  ) {
    return value;
  }
  return "unresolved";
}
