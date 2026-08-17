/** When contact registry ingest should wait for a human instead of auto-applying. */

import type { ShortlistHit } from "@/lib/contacts/registry-shortlist";
import type { ContactAdjudicationDecision } from "@/lib/contacts/registry-shared";

/** Name-ish shortlist floor used by harvest HITL (email match is 100). */
export const CONTACT_HOLD_COMPETITIVE_SCORE = 20;
/** Strong enough that keep_separate against it is suspicious. */
export const CONTACT_HOLD_STRONG_SCORE = 60;
/** Unique-email match; a second candidate below this is ignored. */
export const CONTACT_HOLD_EMAIL_SCORE = 100;
export const CONTACT_HOLD_WEAK_MERGE_SCORE = 40;

export type ContactHoldInput = {
  decision: ContactAdjudicationDecision;
  candidates: ShortlistHit[];
};

/**
 * Return a hold reason, or null to auto-apply.
 * Sparse first-name stubs are not passed here (they skip AI).
 */
export function contactHoldReason(input: ContactHoldInput): string | null {
  const { decision, candidates } = input;
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

  if (competitive.length >= 2) {
    if (
      top &&
      top.score >= CONTACT_HOLD_EMAIL_SCORE &&
      (!second || second.score < 80)
    ) {
      return null;
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
