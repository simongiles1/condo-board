const AGENDA_LINE_BREAK_PATTERNS: RegExp[] = [
  /\s+(?=\d{1,2}\.\s+[A-Z])/g,
  /\s+(?=[A-Z]\.\s+[A-Z])/g,
  /\s+(?=Call to Order\b)/i,
  /\s+(?=Ratification of Agenda\b)/i,
  /\s+(?=Meeting with\b)/i,
  /\s+(?=Review and [Aa]pproval of\b)/i,
  /\s+(?=Property Management Report:?\b)/i,
  /\s+(?=Ratification of email decisions\b)/i,
  /\s+(?=Review and approval of the project\b)/i,
  /\s+(?=The items for discussion\b)/i,
  /\s+(?=Date and time of the next\b)/i,
  /\s+(?=Adjournment\.?\b)/i,
  /\s+(?=Distribution:\b)/i,
  /\s+(?=Board of Directors:\b)/i,
  /\s+(?=ICC Property Management\b)/i,
  /\s+(?=Recording Secretary,\b)/i,
  /\s+(?=TSCC\s+\d+\b)/i,
];

function breakAgendaLikeBody(body: string): string {
  let formatted = body.trim();
  for (const pattern of AGENDA_LINE_BREAK_PATTERNS) {
    formatted = formatted.replace(pattern, "\n");
  }
  return formatted
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Restore readable line breaks for document chunks whose page text was whitespace-normalized. */
export function formatChunkTextForDisplay(raw: string, chunkKind: "document" | "transcript"): string {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  if (chunkKind === "transcript") {
    return text;
  }

  const sectionPageMatch = text.match(
    /^(\[SECTION:[^\]]+\]\s*\(Pages[^)]+\))\s*\n+\s*(PAGE \d+\s*\n)([\s\S]*)$/i,
  );
  if (sectionPageMatch) {
    return `${sectionPageMatch[1]}\n\n${sectionPageMatch[2].trim()}\n${breakAgendaLikeBody(sectionPageMatch[3])}`;
  }

  const pageMatch = text.match(/^(PAGE \d+\s*\n)([\s\S]*)$/i);
  if (pageMatch) {
    return `${pageMatch[1].trim()}\n${breakAgendaLikeBody(pageMatch[2])}`;
  }

  return breakAgendaLikeBody(text);
}
