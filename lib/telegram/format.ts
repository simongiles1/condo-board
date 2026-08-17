/** Format Telegram digest copy and parse inline-button callbacks. */

import type { TelegramReviewRow } from "@/lib/telegram/store";
import type { TelegramInlineKeyboard } from "@/lib/telegram/api";
import type {
  AffiliationReviewPayload,
  ContactReviewPayload,
} from "@/lib/telegram/types";
import { incomingCardLabel } from "@/lib/telegram/types";

export type TelegramCallbackAction = "approved" | "denied";

export function parseTelegramCallbackData(
  data: string | undefined,
): { id: string; action: TelegramCallbackAction } | null {
  if (!data) return null;
  const match = /^(ok|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    data.trim(),
  );
  if (!match) return null;
  return {
    action: match[1] === "ok" ? "approved" : "denied",
    id: match[2]!.toLowerCase(),
  };
}

export function telegramCallbackData(
  id: string,
  action: TelegramCallbackAction,
): string {
  return `${action === "approved" ? "ok" : "no"}:${id}`;
}

export function reviewItemKeyboard(id: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: telegramCallbackData(id, "approved") },
        { text: "Deny", callback_data: telegramCallbackData(id, "denied") },
      ],
    ],
  };
}

const HOLD_REASON_LABEL: Record<string, string> = {
  multiple_candidates: "This mention matches more than one existing person.",
  declined_strong_match: "The model kept this as new despite a strong registry match.",
  weak_merge: "Proposed merge/enrich on a weak name match.",
  model_fallback: "The model did not return a usable decision.",
  needs_review: "Affiliation evidence is mixed — do not auto-link.",
};

function holdReasonLabel(reason: string): string {
  return HOLD_REASON_LABEL[reason] ?? reason.replaceAll("_", " ");
}

export function formatReviewItemMessage(row: TelegramReviewRow): string {
  if (row.kind === "affiliation") {
    let payload: AffiliationReviewPayload;
    try {
      payload = JSON.parse(row.payloadJson) as AffiliationReviewPayload;
    } catch {
      return `Affiliation needs review (${row.id}).`;
    }
    const lines = [
      "Affiliation needs review",
      "",
      `${payload.personName} ↔ ${payload.organizationName}`,
      `${payload.relationType} · ${payload.confidence}`,
    ];
    if (payload.rationale) lines.push(payload.rationale);
    lines.push("", holdReasonLabel(row.holdReason));
    lines.push("Approve links them. Deny keeps them unlinked.");
    return lines.join("\n");
  }

  let payload: ContactReviewPayload;
  try {
    payload = JSON.parse(row.payloadJson) as ContactReviewPayload;
  } catch {
    return `Ambiguous contact (${row.id}).`;
  }

  const incoming = incomingCardLabel(payload.incoming);
  const action = payload.decision.action;
  const target = payload.candidates.find(
    (c) => c.personId === payload.decision.targetPersonId,
  );
  const lines = [
    "Ambiguous contact",
    "",
    `Incoming: ${incoming}`,
    `Proposed: ${action}${target ? ` → ${target.displayName}` : ""}`,
  ];
  if (payload.decision.reason) {
    lines.push(`Model: ${payload.decision.reason}`);
  }
  if (payload.candidates.length > 0) {
    lines.push("Candidates:");
    for (const candidate of payload.candidates) {
      const emails = candidate.emails.length
        ? ` (${candidate.emails.join(", ")})`
        : "";
      lines.push(`- ${candidate.displayName} · ${candidate.score}${emails}`);
    }
  }
  lines.push("", holdReasonLabel(row.holdReason));
  lines.push("Approve applies the proposal. Deny creates a separate person.");
  return lines.join("\n");
}

export function formatResolvedMessage(
  original: string,
  action: TelegramCallbackAction,
): string {
  const suffix =
    action === "approved" ? "Approved in Telegram." : "Denied in Telegram.";
  if (original.includes("Approved in Telegram") || original.includes("Denied in Telegram")) {
    return original;
  }
  return `${original}\n\n${suffix}`;
}
