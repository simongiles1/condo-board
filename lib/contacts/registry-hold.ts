/** When contact registry ingest should wait for a human instead of auto-applying. */

import type { ShortlistHit } from "@/lib/contacts/registry-shortlist";
import {
  isNamelessPerson,
  normalizeContactRegistryEmail,
  personIdentitiesConflict,
  pickCurrentOccupancyPersonId,
  type ContactAdjudicationDecision,
  type ContactRegistryIncomingCard,
} from "@/lib/contacts/registry-shared";

/** Name-ish shortlist floor used by harvest HITL (email match is 100). */
export const CONTACT_HOLD_COMPETITIVE_SCORE = 20;
/** Strong enough that keep_separate against it is suspicious. */
export const CONTACT_HOLD_STRONG_SCORE = 60;
/** Unique-email match; a second candidate below this is ignored. */
export const CONTACT_HOLD_EMAIL_SCORE = 100;
export const CONTACT_HOLD_WEAK_MERGE_SCORE = 40;

export const NAMELESS_ROLE_MAILBOX_REASON = "nameless_role_mailbox_current_occupant";
export const NAMED_ROLE_MAILBOX_REASON = "named_role_mailbox_unique_identity";

export type ContactHoldInput = {
  decision: ContactAdjudicationDecision;
  candidates: ShortlistHit[];
  incoming?: Pick<
    ContactRegistryIncomingCard,
    "first_name" | "last_name" | "email"
  >;
};

function emailOccupancyRows(
  incomingEmail: string | null | undefined,
  candidates: ShortlistHit[],
): Array<{
  personId: string;
  validFrom: string | null;
  validTo: string | null;
}> {
  const key = incomingEmail
    ? normalizeContactRegistryEmail(incomingEmail)
    : "";
  if (!key) return [];
  const rows: Array<{
    personId: string;
    validFrom: string | null;
    validTo: string | null;
  }> = [];
  for (const hit of candidates) {
    for (const row of hit.person.emails) {
      if (normalizeContactRegistryEmail(row.email) === key) {
        rows.push({
          personId: hit.person.id,
          validFrom: row.validFrom,
          validTo: row.validTo,
        });
      }
    }
  }
  return rows;
}

function compatibleHits(
  incoming: ContactHoldInput["incoming"],
  candidates: ShortlistHit[],
): ShortlistHit[] {
  if (!incoming || isNamelessPerson(incoming)) return candidates;
  return candidates.filter(
    (hit) => !personIdentitiesConflict(incoming, hit.person),
  );
}

function sameIdentityFamily(hits: ShortlistHit[]): boolean {
  if (hits.length <= 1) return true;
  const anchor = hits[0]!.person;
  return hits.every((hit) => !personIdentitiesConflict(anchor, hit.person));
}

/**
 * Correct shared/role-mailbox adjudication before hold/apply.
 * Nameless cards attach to the current occupant; named cards that the model
 * aimed at a different human are retargeted to the compatible person.
 */
export function rewriteSharedMailboxDecision(params: {
  incoming: ContactRegistryIncomingCard;
  candidates: ShortlistHit[];
  decision: ContactAdjudicationDecision;
}): ContactAdjudicationDecision {
  const { incoming, candidates, decision } = params;
  const occupancy = emailOccupancyRows(incoming.email, candidates);
  const occupantIds = new Set(occupancy.map((row) => row.personId));
  if (occupantIds.size < 2) return decision;

  if (isNamelessPerson(incoming)) {
    const currentId = pickCurrentOccupancyPersonId(occupancy);
    if (!currentId) return decision;
    return {
      ...decision,
      action: "enrich",
      targetPersonId: currentId,
      email: incoming.email?.trim() || decision.email,
      validFrom: decision.validFrom ?? incoming.dateMin,
      validTo:
        decision.validTo === undefined ? incoming.dateMax : decision.validTo,
      reason: NAMELESS_ROLE_MAILBOX_REASON,
    };
  }

  const compatible = compatibleHits(incoming, candidates)
    .filter((hit) => occupantIds.has(hit.person.id))
    .sort(
      (a, b) =>
        b.score - a.score || b.person.mentionWeight - a.person.mentionWeight,
    );
  if (compatible.length === 0) return decision;

  const target = decision.targetPersonId
    ? candidates.find((hit) => hit.person.id === decision.targetPersonId)
    : null;
  const targetConflicts =
    !!target && personIdentitiesConflict(incoming, target.person);
  if (!targetConflicts && target && occupantIds.has(target.person.id)) {
    return decision;
  }
  if (target && !targetConflicts) return decision;

  return {
    ...decision,
    action: "merge",
    targetPersonId: compatible[0]!.person.id,
    email: incoming.email?.trim() || decision.email,
    reason: NAMED_ROLE_MAILBOX_REASON,
  };
}

/**
 * Return a hold reason, or null to auto-apply.
 * Sparse first-name stubs are not passed here (they skip AI).
 */
export function contactHoldReason(input: ContactHoldInput): string | null {
  const { decision, candidates, incoming } = input;
  const scored = [...candidates].sort(
    (a, b) => b.score - a.score || b.person.mentionWeight - a.person.mentionWeight,
  );
  const top = scored[0];
  const second = scored[1];
  const competitive = scored.filter(
    (hit) => hit.score >= CONTACT_HOLD_COMPETITIVE_SCORE,
  );

  if (
    decision.reason === "parse_fallback" ||
    decision.reason === "fallback_keep_separate"
  ) {
    return "model_fallback";
  }

  if (
    decision.reason === NAMELESS_ROLE_MAILBOX_REASON ||
    decision.reason === NAMED_ROLE_MAILBOX_REASON
  ) {
    return null;
  }

  if (competitive.length >= 2) {
    if (
      top &&
      top.score >= CONTACT_HOLD_EMAIL_SCORE &&
      (!second || second.score < 80)
    ) {
      return null;
    }

    const named = incoming && !isNamelessPerson(incoming);
    if (named) {
      const compatibleCompetitive = compatibleHits(incoming, competitive);
      const targetHit = decision.targetPersonId
        ? scored.find((hit) => hit.person.id === decision.targetPersonId)
        : null;
      const targetCompatible =
        !targetHit || !personIdentitiesConflict(incoming, targetHit.person);
      if (
        targetCompatible &&
        compatibleCompetitive.length >= 1 &&
        sameIdentityFamily(compatibleCompetitive) &&
        (decision.action === "merge" ||
          decision.action === "enrich" ||
          decision.action === "link_email")
      ) {
        return null;
      }
    }

    return "multiple_candidates";
  }

  if (
    top &&
    top.score >= CONTACT_HOLD_STRONG_SCORE &&
    decision.action === "keep_separate"
  ) {
    return "declined_strong_match";
  }

  if (
    (decision.action === "merge" || decision.action === "enrich") &&
    top &&
    top.score < CONTACT_HOLD_WEAK_MERGE_SCORE
  ) {
    return "weak_merge";
  }

  return null;
}
