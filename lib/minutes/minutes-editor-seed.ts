import { jsonToMarkdown } from "@/lib/minutes/json-to-markdown";
import { parseMinutesJsonEnvelope } from "@/lib/minutes/schema-v2";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import { validateMinutesJson } from "@/lib/minutes/schema";
import type { Meeting } from "@/lib/db/types";

/** Normalize for comparing markdown snapshots. */
export function normalizeDraftText(s: string): string {
  return s.trim().replace(/\r\n/g, "\n");
}

/** Markdown derived from structured JSON, or null if unavailable / invalid. */
export function derivedMinutesMarkdown(
  minutesJson: string | null | undefined,
): string | null {
  if (!minutesJson?.trim()) return null;

  const envelope = parseMinutesJsonEnvelope(minutesJson);
  if (envelope.version === "v2" && envelope.v2) {
    return v2ToMarkdown(envelope.v2);
  }

  if (envelope.version === "v1" && envelope.v1Raw) {
    const { value } = validateMinutesJson(envelope.v1Raw);
    return value ? jsonToMarkdown(value) : null;
  }

  return null;
}

/**
 * TipTap seed: prefer JSON-derived markdown when present and it matches the
 * saved body (fresh generation), or when saved body is empty; otherwise keep
 * saved markdown so user edits are not overwritten on reload.
 */
export function minutesEditorSeedMarkdown(meeting: Meeting): string {
  const saved = meeting.minutesContent;
  const derived = derivedMinutesMarkdown(meeting.minutesJson);
  if (!derived) return saved;
  const savedNorm = normalizeDraftText(saved);
  const derivedNorm = normalizeDraftText(derived);
  if (!savedNorm || savedNorm === derivedNorm) return derived;
  return saved;
}
