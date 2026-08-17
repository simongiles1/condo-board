/** After harvest-missing: incremental affiliation needs_review + Telegram digest. */

import { gte } from "drizzle-orm";

import { adjudicateAmbiguousAffiliations } from "@/lib/affiliations/adjudicate";
import { proposePersonOrganizationAffiliations } from "@/lib/affiliations/propose";
import { getDb } from "@/lib/db";
import { contactMergeProposals } from "@/lib/db/schema";
import { enqueueAffiliationNeedsReview } from "@/lib/telegram/affiliations";
import { isTelegramHitlReady } from "@/lib/telegram/recipients";
import { sendUnsentTelegramDigest } from "@/lib/telegram/digest";

export async function runTelegramHitlAfterHarvest(input: {
  startedAt: string;
  harvest: {
    status: "disabled" | "skipped_busy" | "ran";
    kinds: Array<{
      kind: string;
      status: string;
      completedEmails: number;
    }>;
  };
}): Promise<{ sent: number; skipped: number; error: string | null }> {
  if (!(await isTelegramHitlReady())) {
    return { sent: 0, skipped: 0, error: null };
  }
  if (input.harvest.status !== "ran") {
    return { sent: 0, skipped: 0, error: null };
  }

  const contacts = input.harvest.kinds.find((row) => row.kind === "contacts");
  if (contacts?.status === "completed" && (contacts.completedEmails ?? 0) > 0) {
    const db = getDb();
    const proposals = await db
      .select({ resultPersonId: contactMergeProposals.resultPersonId })
      .from(contactMergeProposals)
      .where(gte(contactMergeProposals.createdAt, input.startedAt));
    const personIds = [
      ...new Set(
        proposals
          .map((row) => row.resultPersonId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (personIds.length > 0) {
      try {
        const proposed = await proposePersonOrganizationAffiliations({
          personIds,
        });
        if (proposed.ambiguousPersonIds.length > 0) {
          await adjudicateAmbiguousAffiliations({
            personIds: proposed.ambiguousPersonIds,
          });
        }
        await enqueueAffiliationNeedsReview({ personIds });
      } catch (error) {
        console.error(
          "[telegram] Incremental affiliation propose failed",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return sendUnsentTelegramDigest();
}
