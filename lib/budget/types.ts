import type { EmailAttachmentSummary } from "@/lib/email/attachment-display";

export type BudgetAmountRole = "budget" | "projected";

export type BudgetDocumentKind =
  | "operating-budget"
  | "budget-letter"
  | "budget-notes"
  | "budget-approval"
  | "other-budget";

export type ClassifiedBudgetFilename = {
  kind: BudgetDocumentKind;
  fiscalYearStart: number | null;
  /** False when the filename names a different corporation than TSCC 2517. */
  isThisCorporation: boolean;
};

export type ExtractedBudgetAmount = {
  fiscalYearStart: number;
  role: BudgetAmountRole;
  value: number;
};

export type ExtractedBudgetLine = {
  code: string;
  name: string;
  category: string;
  amounts: ExtractedBudgetAmount[];
};

export type ParsedBudgetMarkdown = {
  lines: ExtractedBudgetLine[];
};

export type LineYearAmounts = {
  budgeted: number | null;
  actual: number | null;
};

export type BudgetLineItem = {
  code: string;
  name: string;
  category: string;
  byYear: Record<number, LineYearAmounts>;
};

export type BudgetYearDocument = EmailAttachmentSummary & {
  receivedAt: string;
  fiscalYearStart: number;
  parseStatus: string | null;
  usedForExtraction: boolean;
  /** Highest-ranked extracted file for this fiscal year (Final > draft, then later email). */
  isPrimarySource: boolean;
};

export type BudgetPageData = {
  years: number[];
  documents: BudgetYearDocument[];
  lines: BudgetLineItem[];
};
