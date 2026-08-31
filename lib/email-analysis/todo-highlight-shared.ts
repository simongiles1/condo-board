/** Client-safe to-do harvest types and helpers (no DB / Gemini imports). */

import { chunkContactHighlightText } from "@/lib/email-analysis/contact-highlight-shared";
import {
  validateEmailExtraction,
  type ActionItemExtraction,
  type EmailExtractionDocument,
} from "@/lib/email-analysis/schema";

export { chunkContactHighlightText as chunkTodoHighlightText };

export type TodoHighlightExtraction = {
  action_items: ActionItemExtraction[];
};

export function emptyTodoHighlightExtraction(): TodoHighlightExtraction {
  return { action_items: [] };
}

export function todoHighlightHasAny(
  extraction: TodoHighlightExtraction,
): boolean {
  return extraction.action_items.length > 0;
}

export function todoHighlightToDocument(
  extraction: TodoHighlightExtraction,
): EmailExtractionDocument {
  return { action_items: extraction.action_items };
}

export function sanitizeTodoHighlightExtraction(
  extraction: TodoHighlightExtraction,
): TodoHighlightExtraction {
  return {
    action_items: extraction.action_items.filter((item) =>
      Boolean(item.task?.trim()),
    ),
  };
}

export function todoHighlightFromDocument(
  document: EmailExtractionDocument,
): TodoHighlightExtraction {
  return sanitizeTodoHighlightExtraction({
    action_items: document.action_items ?? [],
  });
}

export function mergeTodoHighlightExtractions(
  extractions: TodoHighlightExtraction[],
): TodoHighlightExtraction {
  const merged = emptyTodoHighlightExtraction();
  for (const extraction of extractions) {
    merged.action_items.push(...extraction.action_items);
  }
  return sanitizeTodoHighlightExtraction(merged);
}

export function parseTodoHighlightExtraction(
  raw: unknown,
): TodoHighlightExtraction {
  const { document } = validateEmailExtraction(raw);
  return todoHighlightFromDocument(document);
}

export function parseTodoHighlightJson(text: string): TodoHighlightExtraction {
  const trimmed = text.trim();
  if (!trimmed) return emptyTodoHighlightExtraction();
  try {
    return parseTodoHighlightExtraction(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseTodoHighlightExtraction(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyTodoHighlightExtraction();
      }
    }
    return emptyTodoHighlightExtraction();
  }
}

export function buildTodoHighlightSystemPrompt(): string {
  return `You extract unresolved action items (to-dos) from a single condo-board email.

Domain context: These emails concern Studio 1 / TSCC 2517, a Toronto condominium corporation. Extract ONLY information explicitly stated — do not infer, guess, or extrapolate.

Return ONLY valid JSON with this exact shape:
{
  "action_items": [{ "assignee", "task", "deadline", "source_quote" }]
}

Rules:
- Include source_quote as ONE verbatim sentence copied from the body (typically 8–40 words). Never the whole paragraph, never the whole email, never a paraphrase of the task field. That sentence is how a human verifies the task is real.
- Use ISO dates (YYYY-MM-DD) when a firm due date is stated.
- Empty arrays are required when there are no relevant to-dos.
- Do NOT emit contacts, organizations, calendar events, meetings, cancellations, reschedules, hard regulatory deadlines, inspections, maintenance, or equipment. This pass is to-dos only.

CRITICAL — what belongs in action_items[]:
Internal asks, requests, or follow-ups that someone still needs to do. Use this for anything that is not a calendar-worthy event or hard external deadline.

- Set deadline ONLY if the email explicitly states a firm hard date by which the action must be completed (e.g. "must be filed by 2026-08-01"). Do NOT set deadline to the date the email was sent or the date of a related meeting if no actual due date is stated. Phrases like "share any thoughts", "please review", "let me know", "respond when you can", or "before the next meeting" are NOT firm deadlines — omit the deadline field for those.
- Emit ONLY asks still unresolved as of THIS email's content — if quoted thread history in this message shows an ask was already answered, confirmed, scheduled, or otherwise dealt with later in the thread, do NOT emit it.
- Do NOT emit work this email reports as already done, already approved, already investigated, or already completed. A status report answering "what has been done?" is not a list of new to-dos.
- Do NOT emit "awaiting a contractor/solicitor reply" or "will share X when received" unless the email asks someone to chase it. Waiting is not a board action item.
- Do NOT emit resident-wide notices, neighbour check-ins, or FYI broadcasts from building advisories. Those are not board to-dos.
- A form/survey/participation request with several steps (decide, designate a person, upload docs) is ONE obligation — emit a single item, not one per step.
- Follow-up pings ("following up as I never received a reply") are the same obligation as the original ask — do not emit a second item.
- Emit at most ONE action item per distinct unresolved obligation — consolidate near-duplicate phrasings even when assignee names differ (e.g. "Management" vs a named contact) if the underlying board/corporation duty is the same (same police request, same footage release, same filing). Prefer assignee "Management" or "Board" for corporation-wide duties. Join consolidated duties with "and" in one task description.
- Assignee is a free-text name or role as written (person, "Management", "Board"). Do not invent registry IDs.
- Write task in sentence case — capitalize the first word and proper nouns/acronyms only.

When in doubt, prefer omitting a fact over fabricating a task or due date.`;
}

export type TodoHighlightEmailContext = {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  highlightedText: string;
};

export function buildTodoHighlightUserPrompt(
  input: TodoHighlightEmailContext,
): string {
  const toLine =
    input.toAddresses.length > 0 ? input.toAddresses.join(", ") : "(none)";
  const ccLine =
    input.ccAddresses.length > 0 ? input.ccAddresses.join(", ") : "(none)";
  return `EMAIL
From: ${input.fromAddress || "(unknown)"}
To: ${toLine}
Cc: ${ccLine}
Subject: ${input.subject || "(no subject)"}

--- BODY (unique / authored highlight for this message) ---
${input.highlightedText}
---

Extract unresolved action_items as JSON. Omit calendar events, contacts, orgs, and equipment.`;
}
