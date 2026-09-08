/**
 * Two-tier promotion criteria (service_call / incident → capital_project).
 * Keep this module free of server/db imports — tests use it directly.
 */

export const PROMOTION_DURATION_DAYS = 30;
export const PROMOTION_QUOTE_THRESHOLD = 2;

export const PROJECT_PROMOTION_REASONS = [
  "multiple_quotes",
  "board_briefed",
  "duration_over_30_days",
  "manual",
] as const;
export type ProjectPromotionReason = (typeof PROJECT_PROMOTION_REASONS)[number];

export type IncidentPromotionFacts = {
  quoteOrRfpCount: number;
  boardReportCount: number;
  mentionEmailCount: number;
  firstMentionAt: string | null;
  lastMentionAt: string | null;
};

export function daysBetweenIsoInclusive(
  left: string | null | undefined,
  right: string | null | undefined,
): number | null {
  if (!left?.trim() || !right?.trim()) return null;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 86_400_000;
}

export function collectIncidentPromotionReasons(
  facts: IncidentPromotionFacts,
): ProjectPromotionReason[] {
  const reasons: ProjectPromotionReason[] = [];
  if (facts.quoteOrRfpCount >= PROMOTION_QUOTE_THRESHOLD) {
    reasons.push("multiple_quotes");
  }
  if (facts.boardReportCount > 0) {
    reasons.push("board_briefed");
  }
  const spanDays = daysBetweenIsoInclusive(
    facts.firstMentionAt,
    facts.lastMentionAt,
  );
  if (
    facts.mentionEmailCount >= 2 &&
    spanDays != null &&
    spanDays > PROMOTION_DURATION_DAYS
  ) {
    reasons.push("duration_over_30_days");
  }
  return reasons;
}

export function mergePromotionReasons(
  existing: readonly string[],
  next: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reason of [...existing, ...next]) {
    const trimmed = reason.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Payload written onto project_entities — mention FKs are not touched. */
export function capitalProjectPromotionPatch(
  reasons: readonly string[],
  nowIso: string,
): {
  tier: "capital_project";
  promotionReasonsJson: string;
  updatedAt: string;
} {
  return {
    tier: "capital_project",
    promotionReasonsJson: JSON.stringify(reasons),
    updatedAt: nowIso,
  };
}

const QUOTE_FILENAME_RE =
  /\b(?:quote|quotation|rfp|proposal|bid)s?\b|\bpo[-_ ]?\d/i;

export function attachmentFilenameLooksLikeQuote(
  filename: string | null | undefined,
): boolean {
  return Boolean(filename && QUOTE_FILENAME_RE.test(filename));
}

const FORMAL_QUOTE_RE =
  /\b(?:quote|qte|quotation|rfp|po|p\.o\.|invoice|inv)\s*#?\s*[A-Z0-9][-A-Z0-9/]{1,24}/gi;

export function countFormalQuoteIdentifiers(
  texts: readonly (string | null | undefined)[],
): number {
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const re = new RegExp(FORMAL_QUOTE_RE.source, FORMAL_QUOTE_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const token = (match[0] ?? "").trim().toLowerCase();
      if (token) seen.add(token);
    }
  }
  return seen.size;
}
