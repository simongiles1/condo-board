/**
 * Checks a reconciled V3 agenda before a minutes draft is printed.
 * The reconciled conclusion is the investigation. This pass does not invent a decision.
 */

import type { MeetingsV3FactReview } from "@/lib/meeting-v3/facts";
import type { MeetingsV3ItemConclusion } from "@/lib/meeting-v3/meeting-conclusions";
import type { MeetingsV3ValidationFinding } from "@/lib/meeting-v3/workspace";

/** One agenda row the minutes check can read. */
export type MeetingsV3ValidationItem = {
  id: string;
  itemNumber: string;
  title: string;
  conclusion: MeetingsV3ItemConclusion | null;
  reviewIssues: readonly MeetingsV3FactReview[];
};

/**
 * Lists open points that keep the minutes incomplete.
 * A discussed topic with no review issue is not an error.
 */
export function collectMeetingsV3ValidationFindings(
  items: readonly MeetingsV3ValidationItem[],
): MeetingsV3ValidationFinding[] {
  const findings: MeetingsV3ValidationFinding[] = [];
  for (const item of items) {
    if (!item.conclusion) {
      findings.push({
        agendaItemId: item.id,
        itemNumber: item.itemNumber,
        severity: "error",
        code: "missing_conclusion",
        message: `${item.title} has not been reconciled.`,
      });
      continue;
    }
    if (item.conclusion.status === "unclear") {
      findings.push({
        agendaItemId: item.id,
        itemNumber: item.itemNumber,
        severity: "error",
        code: "unclear_conclusion",
        message: `${item.title} has no decision in the assigned transcript.`,
      });
    }
    if (item.conclusion.openReference) {
      findings.push({
        agendaItemId: item.id,
        itemNumber: item.itemNumber,
        severity: "error",
        code: "open_reference",
        message: `${item.title} points at a package fact this topic does not have.`,
      });
    }
    for (const issue of item.reviewIssues) {
      findings.push({
        agendaItemId: item.id,
        itemNumber: item.itemNumber,
        severity: "error",
        code: "fact_review",
        message: `${item.title}: ${issue.message}`,
      });
    }
  }
  return findings;
}
