export const CORP_LONG =
  "Toronto Standard Condominium Corporation No. 2517";
export const CORP_SHORT = "T.S.C.C. #2517";
export const MEETING_TYPE_HEADER = "Board of Directors Meeting";

/** Reject meeting titles and other non-corporation strings stored as corporationName. */
export function isLikelyCorporationName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^minutes\s*[-–—]/i.test(trimmed)) return false;
  return /condominium corporation|(?:t|y)\.?\s*s\.?\s*c\.?\s*c|(?:t|y)\.?\s*r\.?\s*c\.?\s*c/i.test(
    trimmed,
  );
}

export function resolveCorporationName(candidate?: string | null): string {
  const trimmed = candidate?.trim() ?? "";
  if (isLikelyCorporationName(trimmed)) return trimmed;
  return CORP_LONG;
}

export function corpShortFromName(corpLong: string): string {
  const resolved = resolveCorporationName(corpLong);
  const match = /No\.\s*(\d+)/i.exec(resolved);
  if (match) return `T.S.C.C. #${match[1]}`;
  const abbrevMatch =
    /(?:T\.?S\.?C\.?C\.?|Y\.?R\.?C\.?C\.?)\s*#?\s*(\d+)/i.exec(resolved);
  if (abbrevMatch) return `T.S.C.C. #${abbrevMatch[1]}`;
  return CORP_SHORT;
}
