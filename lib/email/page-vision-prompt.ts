/**
 * System / user prompts for Tier 2 page vision transcription.
 */

export const PAGE_VISION_SYSTEM_PROMPT = `You are a document page transcription assistant for a condo board operations system.

Given a single PDF page or image (and optional selectable text already extracted from it), produce faithful Markdown that captures what is visible.

Rules:
- Prefer the provided selectable text as ground truth for printed words, numbers, dates, currency amounts, and identifiers. Do not invent values that are not visible.
- Render clear tabular layouts as Markdown tables. Keep separator rows compact (e.g. \`| --- | --- |\`). Never pad cells or separators with long dash runs.
- For each photograph, figure, diagram, stamp, or handwriting block:
  1. Keep any printed caption/label exactly.
  2. Add a short visual description of what the image shows (setting, objects, condition, notable defects).
- If the page or image is blank or illegible, say so in one short sentence.
- Output Markdown only. No JSON wrapper, no preamble, no closing commentary.
- Paraphrase long boilerplate and standard legal clauses; do not copy multi-sentence passages verbatim.`;

export const PAGE_VISION_RECITATION_ADDENDUM = `A prior attempt was blocked for recitation. Use concise paraphrase and bullet facts. Do not reproduce long passages verbatim. Preserve exact names, dates, dollar amounts, and signature lines.`;

export function pageVisionRecitationFallbackUserText(pageNo: number): string {
  return [
    `Page ${pageNo}: produce Markdown with headings and bullet points.`,
    "Paraphrase narrative and legal boilerplate; no long verbatim blocks.",
    "Use tables only when needed. Describe photos in one short line each.",
  ].join(" ");
}

export function pageVisionUserText(
  pageNo: number,
  nativeText?: string | null,
  options?: { kind?: "pdf" | "image"; fullDocument?: boolean },
): string {
  const kind = options?.kind ?? "pdf";
  if (kind === "image") {
    return "Transcribe this image into Markdown. Include captions and a brief description of every photograph, diagram, stamp, or handwriting block.";
  }

  const pageLead = options?.fullDocument
    ? `Transcribe ONLY page ${pageNo} of the attached multi-page PDF into Markdown. Ignore every other page.`
    : `Transcribe PDF page ${pageNo} into Markdown.`;

  const trimmed = nativeText?.trim() ?? "";
  if (!trimmed) {
    return `${pageLead} Include captions and a brief description of every photograph or diagram.`;
  }
  return [
    `${pageLead}`,
    "Selectable text already extracted from this page (ground truth for printed text — preserve it; focus extra attention on photographs/diagrams and their captions):",
    "-----",
    trimmed,
    "-----",
    "Include every caption and add a brief visual description under each photograph/diagram.",
  ].join("\n");
}
