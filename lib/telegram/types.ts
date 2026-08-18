/** Compact payload stored on telegram_review_items.payload_json. */

import {
  isNamelessPerson,
  normalizeContactRegistryEmail,
  type ContactAdjudicationDecision,
} from "@/lib/contacts/registry-shared";
import type { ShortlistHit } from "@/lib/contacts/registry-shortlist";
import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";

export type TelegramReviewKind = "contact_identity" | "affiliation";
export type TelegramReviewStatus = "pending" | "approved" | "denied";

export type ContactReviewCandidate = {
  personId: string;
  displayName: string;
  score: number;
  emails: string[];
};

export type ContactReviewPayload = {
  incoming: ContactEntityCard & {
    tempId: string;
    sourceEmailIds: string[];
    dateMin: string | null;
    dateMax: string | null;
    mentionWeight: number;
    blockingKeys: string[];
  };
  decision: ContactAdjudicationDecision;
  candidates: ContactReviewCandidate[];
  modelId: string;
};

export type AffiliationReviewPayload = {
  personId: string;
  personName: string;
  organizationId: string;
  organizationName: string;
  relationType: string;
  confidence: string;
  rationale: string | null;
};

export type TelegramReviewPayload =
  | ContactReviewPayload
  | AffiliationReviewPayload;

export function compactContactCandidates(
  hits: ShortlistHit[],
): ContactReviewCandidate[] {
  return hits.slice(0, 5).map((hit) => ({
    personId: hit.person.id,
    displayName: [hit.person.firstName, hit.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || hit.person.id,
    score: hit.score,
    emails: hit.person.emails.slice(0, 3).map((row) => row.email),
  }));
}

export function incomingCardLabel(card: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const name = [card.first_name, card.last_name].filter(Boolean).join(" ").trim();
  if (name && card.email) return `${name} <${card.email}>`;
  return name || card.email?.trim() || "unnamed contact";
}

export function contactReviewEmailKey(card: {
  email?: string | null;
}): string {
  return card.email?.trim()
    ? normalizeContactRegistryEmail(card.email)
    : "";
}

/** One pending review per mailbox + identity (nameless shares the mailbox key). */
export function contactReviewIdentityKey(card: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const email = contactReviewEmailKey(card);
  const name = isNamelessPerson(card)
    ? "nameless"
    : [card.first_name, card.last_name]
        .map((part) => part?.trim().toLowerCase())
        .filter(Boolean)
        .join(" ");
  return `${email}|${name}`;
}
