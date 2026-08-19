/**
 * Whether a mention / fingerprint card is actually present on one email.
 * Thread-wide evidence is not enough — the name, email, or phone must appear
 * on that message (headers or body).
 */

import { mentionFirstNameKey } from "@/lib/contacts/mention-shared";
import { isWeakNameVariantOf, normalizeContactRegistryEmail } from "@/lib/contacts/registry-shared";
import { extractMailboxEmail } from "@/lib/email/address-display";
import { normalizePhone } from "@/lib/email/entity-dedup";

export type MentionPresenceCard = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
};

export type MentionPresenceEmail = {
  subject?: string | null;
  bodyText?: string | null;
  bodyTextUnique?: string | null;
  bodyTextStrictUnique?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | string | null;
  ccAddresses?: string[] | string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseAddressList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
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

/**
 * Body used to decide whether this *message* named the person.
 * Prefer thread-unique text so quoted reply history does not count.
 * `null` unique fields mean “not computed”; empty string means “computed, none.”
 */
export function mentionSearchBody(email: MentionPresenceEmail): string {
  if (email.bodyTextStrictUnique != null) {
    return email.bodyTextStrictUnique.trim();
  }
  if (email.bodyTextUnique != null) {
    return email.bodyTextUnique.trim();
  }
  return (email.bodyText ?? "").trim();
}

export function uniqueBodyFieldsAreStored(
  email: Pick<MentionPresenceEmail, "bodyTextUnique" | "bodyTextStrictUnique">,
): boolean {
  return email.bodyTextStrictUnique != null || email.bodyTextUnique != null;
}

/**
 * Unique authored body mentions search — also the teal overlay / harvest
 * excerpt source. Live unique is used only when those columns were never
 * computed.
 */
export function resolveMentionUniqueBody(
  email: MentionPresenceEmail,
  liveUnique?: string | null,
): string {
  if (uniqueBodyFieldsAreStored(email)) {
    return mentionSearchBody(email);
  }
  if (liveUnique != null) return liveUnique.trim();
  return (email.bodyText ?? "").trim();
}

/** Subject + unique authored body + From/To/Cc. */
export function mentionPresenceHaystack(email: MentionPresenceEmail): string {
  const headers = [
    email.fromAddress ?? "",
    ...parseAddressList(email.toAddresses),
    ...parseAddressList(email.ccAddresses),
  ];
  return [email.subject ?? "", mentionSearchBody(email), ...headers]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/** Whole-token match so "Ann" does not hit "Annual". */
export function textHasNameToken(text: string, name: string): boolean {
  const needle = name.trim();
  if (!needle || !text) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return pattern.test(text);
}

function cardEmailKey(card: MentionPresenceCard): string | null {
  const raw = card.email?.trim();
  if (!raw) return null;
  const mailbox = extractMailboxEmail(raw) ?? raw;
  const key = normalizeContactRegistryEmail(mailbox);
  return key.includes("@") ? key : null;
}

function haystackHasEmail(haystack: string, emailKey: string): boolean {
  if (!emailKey || !haystack) return false;
  return haystack.toLowerCase().includes(emailKey);
}

function haystackHasPhone(haystack: string, phone: string | null | undefined): boolean {
  const digits = phone ? normalizePhone(phone) : "";
  if (digits.length < 7) return false;
  return normalizePhone(haystack).includes(digits);
}

function haystackHasPersonName(haystack: string, card: MentionPresenceCard): boolean {
  const first = card.first_name?.trim() || "";
  const last = card.last_name?.trim() || "";
  if (first && last) {
    const full = `${first} ${last}`;
    const reversed = `${last}, ${first}`;
    return (
      textHasNameToken(haystack, full) ||
      textHasNameToken(haystack, reversed) ||
      (textHasNameToken(haystack, first) && textHasNameToken(haystack, last))
    );
  }
  if (first) return textHasNameToken(haystack, first);
  if (last) return textHasNameToken(haystack, last);
  return false;
}

/**
 * True when this card's identity is visible on the email (mailbox, phone,
 * or name tokens in subject / body / headers).
 */
export function mentionCardAppearsInEmail(
  card: MentionPresenceCard,
  email: MentionPresenceEmail,
): boolean {
  const haystack = mentionPresenceHaystack(email);
  if (!haystack.trim()) return false;

  const emailKey = cardEmailKey(card);
  if (emailKey && haystackHasEmail(haystack, emailKey)) return true;
  if (haystackHasPhone(haystack, card.phone)) return true;
  if (haystackHasPersonName(haystack, card)) return true;

  const title = card.job_title?.trim();
  if (title && haystack.toLowerCase().includes(title.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * True when a per-email pass-3 card is the same person as a thread-merged card
 * (same mailbox / phone, or a weaker name stub of the merged person).
 */
export function sourceCardContributedToMerged(
  source: MentionPresenceCard,
  merged: MentionPresenceCard,
): boolean {
  const sourceEmail = cardEmailKey(source);
  const mergedEmail = cardEmailKey(merged);
  if (sourceEmail && mergedEmail) return sourceEmail === mergedEmail;

  const sourcePhone = source.phone ? normalizePhone(source.phone) : "";
  const mergedPhone = merged.phone ? normalizePhone(merged.phone) : "";
  if (sourcePhone.length >= 7 && mergedPhone.length >= 7) {
    return sourcePhone === mergedPhone;
  }

  const sourceFirst = mentionFirstNameKey(source.first_name);
  const mergedFirst = mentionFirstNameKey(merged.first_name);
  if (!sourceFirst || !mergedFirst || sourceFirst !== mergedFirst) {
    return false;
  }

  const sourceLast = source.last_name?.trim().toLowerCase() ?? "";
  const mergedLast = merged.last_name?.trim().toLowerCase() ?? "";
  if (!sourceLast || !mergedLast) return true;
  if (sourceLast === mergedLast) return true;
  return (
    isWeakNameVariantOf(source, merged) || isWeakNameVariantOf(merged, source)
  );
}

/**
 * Emails in a thread that actually produced this merged person.
 * `cardsByEmailId` should omit keys when pass-3 was never stored (caller may
 * fall back to a body/header presence check for those ids).
 */
export function sourceEmailIdsForMergedCard(params: {
  merged: MentionPresenceCard;
  threadEmailIds: string[];
  cardsByEmailId: Map<string, MentionPresenceCard[]>;
}): { attributed: string[]; missingPass3: string[] } {
  const attributed: string[] = [];
  const missingPass3: string[] = [];
  const seen = new Set<string>();

  for (const emailId of params.threadEmailIds) {
    const id = emailId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!params.cardsByEmailId.has(id)) {
      missingPass3.push(id);
      continue;
    }
    const cards = params.cardsByEmailId.get(id) ?? [];
    if (cards.some((card) => sourceCardContributedToMerged(card, params.merged))) {
      attributed.push(id);
    }
  }

  return { attributed, missingPass3 };
}
