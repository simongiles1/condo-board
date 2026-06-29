export const VALIDATION_SIGNIFICANCE_LEVELS = [
  "critical",
  "moderate",
  "minor",
] as const;

export type ValidationSignificance =
  (typeof VALIDATION_SIGNIFICANCE_LEVELS)[number];

export type ValidationFinding = {
  id: string;
  topic: string;
  detail: string;
  section?: string;
  significance: ValidationSignificance;
};

export type GoldStandardValidationResult = {
  schemaVersion: "validation_v1";
  analyzedAt: string;
  validationScore: number;
  scoreRationale: string;
  generatedOnly: ValidationFinding[];
  goldOnly: ValidationFinding[];
  noSignificantDifferences?: boolean;
};

export type ValidateGoldStandardValidationResult = {
  value: GoldStandardValidationResult | null;
  warnings: string[];
  errors: string[];
};

function newFindingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function normalizeSignificance(raw: unknown): ValidationSignificance {
  const s = asString(raw).toLowerCase();
  if (
    s === "critical" ||
    s === "moderate" ||
    s === "minor"
  ) {
    return s;
  }
  return "moderate";
}

function normalizeFinding(
  raw: unknown,
  errors: string[],
  index: number,
  arrayName: string,
): ValidationFinding | null {
  if (!isRecord(raw)) {
    errors.push(`${arrayName}[${index}] must be an object.`);
    return null;
  }

  const topic = asString(raw.topic);
  const detail = asString(raw.detail);
  const sectionRaw = asString(raw.section);
  const significance = normalizeSignificance(raw.significance);

  if (!topic) {
    errors.push(`${arrayName}[${index}] missing topic.`);
  }
  if (!detail) {
    errors.push(`${arrayName}[${index}] missing detail.`);
  }

  if (!topic || !detail) {
    return null;
  }

  return {
    id: asString(raw.id) || newFindingId(),
    topic,
    detail,
    ...(sectionRaw ? { section: sectionRaw } : {}),
    significance,
  };
}

function normalizeFindingsArray(
  raw: unknown,
  errors: string[],
  arrayName: string,
): ValidationFinding[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${arrayName} must be an array.`);
    return [];
  }

  const findings: ValidationFinding[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const finding = normalizeFinding(raw[i], errors, i, arrayName);
    if (finding) {
      findings.push(finding);
    }
  }
  return findings;
}

function clampScore(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(100, Math.max(0, Math.round(n)));
    }
  }
  return null;
}

export function validateGoldStandardValidation(
  raw: unknown,
): ValidateGoldStandardValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return {
      value: null,
      warnings,
      errors: ["Validation result must be a JSON object."],
    };
  }

  const schemaVersion = asString(raw.schema_version ?? raw.schemaVersion);
  if (schemaVersion !== "validation_v1") {
    errors.push(`Unsupported schema_version: ${schemaVersion || "(missing)"}.`);
  }

  const analyzedAt = asString(raw.analyzed_at ?? raw.analyzedAt);
  if (!analyzedAt) {
    errors.push("Missing analyzed_at.");
  }

  const validationScore = clampScore(
    raw.validation_score ?? raw.validationScore,
  );
  if (validationScore === null) {
    errors.push("Missing or invalid validation_score (0–100).");
  }

  const scoreRationale = asString(
    raw.score_rationale ?? raw.scoreRationale,
  );
  if (!scoreRationale) {
    errors.push("Missing score_rationale.");
  }

  const generatedOnly = normalizeFindingsArray(
    raw.generated_only ?? raw.generatedOnly,
    errors,
    "generated_only",
  );
  const goldOnly = normalizeFindingsArray(
    raw.gold_only ?? raw.goldOnly,
    errors,
    "gold_only",
  );

  if (
    errors.length > 0 ||
    validationScore === null ||
    !analyzedAt ||
    !scoreRationale
  ) {
    return { value: null, warnings, errors };
  }

  const noSignificantDifferences =
    raw.no_significant_differences === true ||
    raw.noSignificantDifferences === true;

  return {
    value: {
      schemaVersion: "validation_v1",
      analyzedAt,
      validationScore,
      scoreRationale,
      generatedOnly,
      goldOnly,
      ...(noSignificantDifferences ? { noSignificantDifferences: true } : {}),
    },
    warnings,
    errors: [],
  };
}

export function serializeGoldStandardValidation(
  result: GoldStandardValidationResult,
): string {
  return JSON.stringify({
    schema_version: result.schemaVersion,
    analyzed_at: result.analyzedAt,
    validation_score: result.validationScore,
    score_rationale: result.scoreRationale,
    generated_only: result.generatedOnly.map((finding) => ({
      id: finding.id,
      topic: finding.topic,
      detail: finding.detail,
      ...(finding.section ? { section: finding.section } : {}),
      significance: finding.significance,
    })),
    gold_only: result.goldOnly.map((finding) => ({
      id: finding.id,
      topic: finding.topic,
      detail: finding.detail,
      ...(finding.section ? { section: finding.section } : {}),
      significance: finding.significance,
    })),
    ...(result.noSignificantDifferences
      ? { no_significant_differences: true }
      : {}),
  });
}

export function parseStoredGoldStandardValidation(
  raw: string | null | undefined,
): GoldStandardValidationResult | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = validateGoldStandardValidation(parsed);
    return result.value;
  } catch {
    return null;
  }
}

export function validationScoreLabel(score: number): string {
  return `${Math.round(score)}%`;
}

export type ValidationScoreTier = "high" | "medium" | "low";

export function validationScoreTier(score: number): ValidationScoreTier {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

export function validationScoreBadgeClasses(score: number): string {
  const tier = validationScoreTier(score);
  if (tier === "high") {
    return "bg-emerald-100 text-emerald-900 ring-emerald-200";
  }
  if (tier === "medium") {
    return "bg-amber-100 text-amber-900 ring-amber-200";
  }
  return "bg-rose-100 text-rose-900 ring-rose-200";
}

export function significanceLabel(significance: ValidationSignificance): string {
  const labels: Record<ValidationSignificance, string> = {
    critical: "Critical",
    moderate: "Moderate",
    minor: "Minor",
  };
  return labels[significance];
}

export function significanceChipClasses(
  significance: ValidationSignificance,
): string {
  if (significance === "critical") {
    return "bg-rose-100 text-rose-800 ring-rose-200";
  }
  if (significance === "moderate") {
    return "bg-amber-100 text-amber-800 ring-amber-200";
  }
  return "bg-slate-100 text-slate-700 ring-slate-200";
}
