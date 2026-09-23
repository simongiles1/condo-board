const DETERMINISTIC_DRAFT_BLOCKERS = new Set([
  "ai_validation_failed",
  "missing_evidence",
  "missing_investigation",
  "stale_investigation",
  "unresolved_facts",
  "fact_processing_failed",
]);

function parseValidationDetails(detailsJson: string | null | undefined): Record<string, unknown> | null {
  if (!detailsJson) return null;
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * True when validation findings should block draft generation for an agenda item.
 */
export function itemValidationBlocksDraft(
  findings: Array<{ severity: string; code: string; detailsJson?: string | null }>,
): boolean {
  const verdictRow = findings.find((entry) => entry.code === "ai_verdict");
  const verdictDetails = parseValidationDetails(verdictRow?.detailsJson);
  if (verdictDetails?.verdict === "fail") return true;
  return findings.some(
    (entry) =>
      entry.severity === "error" &&
      (entry.code === "ai_verdict" || DETERMINISTIC_DRAFT_BLOCKERS.has(entry.code)),
  );
}
