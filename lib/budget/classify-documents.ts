import type {
  BudgetDocumentKind,
  ClassifiedBudgetFilename,
} from "@/lib/budget/types";

const CONDO_NUMBER = "2517";

const FISCAL_RANGE_RE = /(\d{4})\s*[-–]\s*(\d{4})/;

function otherCorporationNumber(filename: string): string | null {
  const matches = [...filename.matchAll(/TSCC\s*(\d{3,5})/gi)];
  for (const match of matches) {
    const number = match[1];
    if (number && number !== CONDO_NUMBER) return number;
  }
  return null;
}

function fiscalYearStartFromFilename(filename: string): number | null {
  const range = filename.match(FISCAL_RANGE_RE);
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (end !== start + 1) return null;
  return start;
}

/**
 * Rank operating-budget files so a Final PDF beats drafts when merging figures.
 */
export function rankOperatingBudgetFilename(filename: string): number {
  const lower = filename.toLowerCase();
  let score = 0;
  if (/\bfinal\b/.test(lower) && !/final draft/.test(lower)) score += 100;
  else if (/final draft/.test(lower)) score += 40;
  if (/package/.test(lower)) score += 20;
  if (/\.pdf$/i.test(filename)) score += 10;
  if (/\.xlsx$/i.test(filename)) score += 5;
  if (/\bdraft\b/.test(lower) && !/\bfinal\b/.test(lower)) score -= 40;
  if (/\bv1\b/.test(lower)) score -= 15;
  return score;
}

export function classifyBudgetFilename(
  filename: string,
): ClassifiedBudgetFilename | null {
  if (!/budget/i.test(filename)) return null;

  const isThisCorporation = otherCorporationNumber(filename) == null;
  const fiscalYearStart = fiscalYearStartFromFilename(filename);

  let kind: BudgetDocumentKind = "other-budget";
  if (/budget\s*letter/i.test(filename)) {
    kind = "budget-letter";
  } else if (/budget\s*notes/i.test(filename)) {
    kind = "budget-notes";
  } else if (/approval\s*form/i.test(filename) || /budget approval/i.test(filename)) {
    kind = "budget-approval";
  } else if (
    /budget\s+template/i.test(filename) ||
    /budget\s+package/i.test(filename) ||
    new RegExp(`TSCC\\s*${CONDO_NUMBER}\\s+Budget\\s+\\d{4}\\s*[-–]\\s*\\d{4}`, "i").test(
      filename,
    )
  ) {
    kind = "operating-budget";
  }

  return { kind, fiscalYearStart, isThisCorporation };
}

export function isOperatingBudgetForThisCorporation(filename: string): boolean {
  const classified = classifyBudgetFilename(filename);
  return (
    classified != null &&
    classified.isThisCorporation &&
    classified.kind === "operating-budget" &&
    classified.fiscalYearStart != null
  );
}

export function formatFiscalYearLabel(fiscalYearStart: number): string {
  return `${fiscalYearStart}–${fiscalYearStart + 1}`;
}
