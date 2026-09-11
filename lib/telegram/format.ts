/** Format Telegram digest copy and parse inline-button callbacks. */

import type { TelegramReviewRow } from "@/lib/telegram/store";
import type { TelegramInlineKeyboard } from "@/lib/telegram/api";
import type {
  AffiliationReviewPayload,
  ContactReviewPayload,
} from "@/lib/telegram/types";
import { incomingCardLabel } from "@/lib/telegram/types";

export type TelegramCallbackAction =
  | "approved"
  | "denied"
  | "back"
  | "continue"
  | "loading";

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseTelegramCallbackData(
  data: string | undefined,
): { id: string; action: TelegramCallbackAction } | null {
  if (!data) return null;
  const match = new RegExp(`^(ok|no|bk|go|ld):(${UUID})$`, "i").exec(
    data.trim(),
  );
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  const action: TelegramCallbackAction =
    prefix === "ok"
      ? "approved"
      : prefix === "no"
        ? "denied"
        : prefix === "bk"
          ? "back"
          : prefix === "ld"
            ? "loading"
            : "continue";
  return {
    action,
    id: match[2]!.toLowerCase(),
  };
}

export function telegramCallbackData(
  id: string,
  action: TelegramCallbackAction,
): string {
  const prefix =
    action === "approved"
      ? "ok"
      : action === "denied"
        ? "no"
        : action === "back"
          ? "bk"
          : action === "loading"
            ? "ld"
            : "go";
  return `${prefix}:${id}`;
}

const TELEGRAM_LOADING_BUTTON_LABEL = "Working…";

function telegramLoadingKeyboard(id: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: TELEGRAM_LOADING_BUTTON_LABEL,
          callback_data: telegramCallbackData(id, "loading"),
        },
      ],
    ],
  };
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

export function allowlistReviewKeyboard(
  id: string,
  options: { showBack: boolean },
): TelegramInlineKeyboard {
  const row: Array<{ text: string; callback_data: string }> = [
    { text: "Approve", callback_data: telegramCallbackData(id, "approved") },
    { text: "Deny", callback_data: telegramCallbackData(id, "denied") },
  ];
  if (options.showBack) {
    row.push({ text: "Back", callback_data: telegramCallbackData(id, "back") });
  }
  return { inline_keyboard: [row] };
}

export function ingestContinueKeyboard(id: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "Continue", callback_data: telegramCallbackData(id, "continue") }],
    ],
  };
}

export function ingestContinueLoadingKeyboard(id: string): TelegramInlineKeyboard {
  return telegramLoadingKeyboard(id);
}

export function allowlistReviewLoadingKeyboard(id: string): TelegramInlineKeyboard {
  return telegramLoadingKeyboard(id);
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
  if (row.kind === "allowlist_sender" || row.kind === "ingest_stage") {
    try {
      const payload = JSON.parse(row.payloadJson) as { text?: string };
      if (typeof payload.text === "string" && payload.text.trim()) {
        return payload.text;
      }
    } catch {
      /* fall through */
    }
    return row.kind === "allowlist_sender"
      ? "Allowlist review pending."
      : "Ingest pipeline waiting to continue.";
  }

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
    action === "approved"
      ? "Approved in Telegram."
      : action === "denied"
        ? "Denied in Telegram."
        : action === "back"
          ? "Went back in Telegram."
          : "Continued in Telegram.";
  if (
    original.includes("Approved in Telegram") ||
    original.includes("Denied in Telegram") ||
    original.includes("Went back in Telegram") ||
    original.includes("Continued in Telegram")
  ) {
    return original;
  }
  return `${original}\n\n${suffix}`;
}
