/** Apply Approve / Deny from Telegram onto the same tables the Entities UI uses. */

import { approveAffiliation, denyAffiliation } from "@/lib/affiliations/apply";
import { adjudicateAmbiguousAffiliations } from "@/lib/affiliations/adjudicate";
import { proposePersonOrganizationAffiliations } from "@/lib/affiliations/propose";
import { applyAdjudicationDecisions } from "@/lib/contacts/registry-apply";
import type { ContactAdjudicationDecision } from "@/lib/contacts/registry-shared";
import {
  getTelegramReviewItem,
  markTelegramReviewResolved,
  type TelegramReviewRow,
} from "@/lib/telegram/store";
import type { TelegramCallbackAction } from "@/lib/telegram/format";
import type { ContactReviewPayload } from "@/lib/telegram/types";
import { enqueueAffiliationNeedsReview } from "@/lib/telegram/affiliations";

function parseContactPayload(row: TelegramReviewRow): ContactReviewPayload {
  return JSON.parse(row.payloadJson) as ContactReviewPayload;
}

function denyContactDecision(
  decision: ContactAdjudicationDecision,
): ContactAdjudicationDecision {
  return {
    ...decision,
    action: "keep_separate",
    targetPersonId: null,
    email: null,
    validFrom: null,
    validTo: null,
    reason: decision.reason
      ? `${decision.reason}; telegram_denied`
      : "telegram_denied",
  };
}

async function applyContactReview(
  row: TelegramReviewRow,
  action: TelegramCallbackAction,
): Promise<{ personId: string | null }> {
  const payload = parseContactPayload(row);
  const decision =
    action === "approved" ? payload.decision : denyContactDecision(payload.decision);

  const applied = await applyAdjudicationDecisions({
    incoming: [payload.incoming],
    decisions: [decision],
    modelId: payload.modelId,
    fingerprintMergeId: row.fingerprintMergeId,
  });

  return { personId: applied.resultPersonIds[0] ?? null };
}

export async function resolveTelegramReviewItem(input: {
  id: string;
  action: TelegramCallbackAction;
  via: "telegram" | "ui";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getTelegramReviewItem(input.id);
  if (!row) return { ok: false, error: "Review item not found." };
  if (row.status !== "pending") return { ok: true };

  if (row.kind === "affiliation") {
    if (!row.affiliationId) {
      return { ok: false, error: "Affiliation review is missing affiliationId." };
    }
    const result =
      input.action === "approved"
        ? await approveAffiliation({ affiliationId: row.affiliationId })
        : await denyAffiliation({ affiliationId: row.affiliationId });
    if (!result.ok) return result;
    await markTelegramReviewResolved({
      id: row.id,
      status: input.action,
      via: input.via,
    });
    return { ok: true };
  }

  try {
    const { personId } = await applyContactReview(row, input.action);
    await markTelegramReviewResolved({
      id: row.id,
      status: input.action,
      via: input.via,
    });

    const followPersonIds = personId ? [personId] : [];
    if (followPersonIds.length > 0) {
      const proposed = await proposePersonOrganizationAffiliations({
        personIds: followPersonIds,
      });
      if (proposed.ambiguousPersonIds.length > 0) {
        await adjudicateAmbiguousAffiliations({
          personIds: proposed.ambiguousPersonIds,
        });
      }
      await enqueueAffiliationNeedsReview({ personIds: followPersonIds });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not apply contact decision.",
    };
  }
}
