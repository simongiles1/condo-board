/** Decision-verification findings: motions/decisions in the minutes that the
 * transcript does not clearly support. Stored alongside the omissions analysis
 * in the meeting's `omissions_analysis_json` column (no separate DB column). */

function newFlagId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const DECISION_VERDICTS = [
  "contradicted",
  "unsupported",
  "uncertain",
  "supported",
] as const;
export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];

export type DecisionFlag = {
  id: string;
  topic: string;
  section: string;
  claimedDecision: string;
  verdict: DecisionVerdict;
  transcriptEvidence: string;
  explanation: string;
  suggestedFix?: string;
  /** Machine locators so a correction can be applied to the right item. */
  targetSection?: string;
  itemIndex?: number;
  postTerminationTitle?: string;
};

export type ValidateVerificationResult = {
  flags: DecisionFlag[];
  noIssues: boolean;
  analyzedAt: string;
  warnings: string[];
  errors: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function normalizeVerdict(raw: unknown): DecisionVerdict {
  const s = asString(raw).toLowerCase();
  if ((DECISION_VERDICTS as readonly string[]).includes(s)) {
    return s as DecisionVerdict;
  }
  return "uncertain";
}

function normalizeItemIndex(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

function normalizeDecisionFlag(
  raw: unknown,
  errors: string[],
  index: number,
): DecisionFlag | null {
  if (!isRecord(raw)) {
    errors.push(`flags[${index}] must be an object.`);
    return null;
  }

  const topic = asString(raw.topic);
  const section = asString(raw.section);
  const claimedDecision = asString(
    raw.claimed_decision ?? raw.claimedDecision,
  );
  const verdict = normalizeVerdict(raw.verdict);
  const transcriptEvidence = asString(
    raw.transcript_evidence ?? raw.transcriptEvidence,
  );
  const explanation = asString(raw.explanation);
  const suggestedFix = asString(raw.suggested_fix ?? raw.suggestedFix);
  const targetSection = asString(raw.target_section ?? raw.targetSection);
  const itemIndex = normalizeItemIndex(
    raw.existing_item_index ?? raw.itemIndex ?? raw.item_index,
  );
  const postTerminationTitle = asString(
    raw.post_termination_title ?? raw.postTerminationTitle,
  );

  if (!topic) errors.push(`flags[${index}] missing topic.`);
  if (!explanation) errors.push(`flags[${index}] missing explanation.`);

  if (!topic || !explanation) return null;

  return {
    id: asString(raw.id) || newFlagId(),
    topic,
    section: section || "Unknown section",
    claimedDecision,
    verdict,
    transcriptEvidence,
    explanation,
    ...(suggestedFix ? { suggestedFix } : {}),
    ...(targetSection ? { targetSection } : {}),
    ...(itemIndex !== undefined ? { itemIndex } : {}),
    ...(postTerminationTitle ? { postTerminationTitle } : {}),
  };
}

/** Parse and coerce the verification LLM response. */
export function validateVerificationAnalysis(
  raw: unknown,
): ValidateVerificationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return {
        flags: [],
        noIssues: false,
        analyzedAt: "",
        warnings,
        errors: ["Verification analysis is not valid JSON."],
      };
    }
  }

  if (!isRecord(data)) {
    return {
      flags: [],
      noIssues: false,
      analyzedAt: "",
      warnings,
      errors: ["Root must be a JSON object."],
    };
  }

  const schemaVersion = asString(data.schema_version ?? data.schemaVersion);
  if (schemaVersion !== "verification_v1") {
    errors.push('schema_version must be "verification_v1".');
  }

  const analyzedAt = asString(data.analyzed_at ?? data.analyzedAt);

  const flagsRaw = data.flags;
  if (flagsRaw !== undefined && !Array.isArray(flagsRaw)) {
    errors.push("flags must be an array.");
    return { flags: [], noIssues: false, analyzedAt, warnings, errors };
  }

  const flags: DecisionFlag[] = [];
  if (Array.isArray(flagsRaw)) {
    for (let i = 0; i < flagsRaw.length; i += 1) {
      const flag = normalizeDecisionFlag(flagsRaw[i], errors, i);
      // Drop supported verdicts — they are not actionable findings.
      if (flag && flag.verdict !== "supported") flags.push(flag);
    }
  }

  const noIssues =
    data.no_issues === true ||
    data.noIssues === true ||
    flags.length === 0;

  if (errors.length > 0) {
    return { flags: [], noIssues: false, analyzedAt, warnings, errors };
  }

  return {
    flags,
    noIssues,
    analyzedAt: analyzedAt || new Date().toISOString(),
    warnings,
    errors: [],
  };
}

/** Lenient parse of stored decision flags (skips malformed entries). */
export function parseDecisionFlagsArray(raw: unknown): DecisionFlag[] {
  if (!Array.isArray(raw)) return [];
  const flags: DecisionFlag[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const flag = normalizeDecisionFlag(raw[i], [], i);
    if (flag) flags.push(flag);
  }
  return flags;
}

/** Serialize decision flags for DB storage (snake_case). */
export function serializeDecisionFlags(flags: DecisionFlag[]): unknown[] {
  return flags.map((f) => ({
    id: f.id,
    topic: f.topic,
    section: f.section,
    claimed_decision: f.claimedDecision,
    verdict: f.verdict,
    transcript_evidence: f.transcriptEvidence,
    explanation: f.explanation,
    ...(f.suggestedFix ? { suggested_fix: f.suggestedFix } : {}),
    ...(f.targetSection ? { target_section: f.targetSection } : {}),
    ...(f.itemIndex !== undefined ? { existing_item_index: f.itemIndex } : {}),
    ...(f.postTerminationTitle
      ? { post_termination_title: f.postTerminationTitle }
      : {}),
  }));
}

export function verdictLabel(verdict: DecisionVerdict): string {
  const labels: Record<DecisionVerdict, string> = {
    contradicted: "Contradicted",
    unsupported: "Unsupported",
    uncertain: "Uncertain",
    supported: "Supported",
  };
  return labels[verdict];
}
