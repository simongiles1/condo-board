/** Client-safe helpers for transcript vs agenda alignment (no Node/db imports). */

export type TranscriptDiscrepancyKind = "add_to_agenda" | "status_inquiry";

/** Normalize agenda/discrepancy titles for fuzzy equality checks. */
export function normalizeAgendaTitleForMatch(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function agendaTitlesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeAgendaTitleForMatch(left);
  const normalizedRight = normalizeAgendaTitleForMatch(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

export function resolveTranscriptDiscrepancyKind(disc: {
  kind?: TranscriptDiscrepancyKind;
  id?: string;
  clarificationQuestion?: string;
}): TranscriptDiscrepancyKind {
  if (disc.kind === "status_inquiry") return "status_inquiry";
  if (disc.id?.startsWith("inquiry-")) return "status_inquiry";
  if (/marked Not Discussed/i.test(disc.clarificationQuestion ?? "")) {
    return "status_inquiry";
  }
  return "add_to_agenda";
}

/** Drop "add to agenda" discrepancies that already match a synthesized agenda item title. */
export function filterRedundantAddToAgendaDiscrepancies<
  T extends {
    kind?: TranscriptDiscrepancyKind;
    id?: string;
    clarificationQuestion?: string;
    suggestedTitle: string;
  },
>(discrepancies: T[], agendaTitles: string[]): T[] {
  if (agendaTitles.length === 0) return discrepancies;
  return discrepancies.filter((disc) => {
    if (resolveTranscriptDiscrepancyKind(disc) !== "add_to_agenda") return true;
    return !agendaTitles.some((title) => agendaTitlesMatch(title, disc.suggestedTitle));
  });
}
