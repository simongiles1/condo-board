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

export const GOLD_STANDARD_SCHEMA_VERSIONS = [
  "validation_v1",
  "compare_v2",
] as const;

export type GoldStandardSchemaVersion =
  (typeof GOLD_STANDARD_SCHEMA_VERSIONS)[number];

export const COMPARE_TEXT_MARKS = [
  "same",
  "added",
  "omitted",
  "changed",
  "motion",
  "amount",
] as const;

export type CompareTextMark = (typeof COMPARE_TEXT_MARKS)[number];

export const GOLD_STANDARD_CONCEPT_KINDS = [
  "attendance",
  "call_to_order",
  "previous_minutes",
  "agenda_item",
  "financial",
  "next_meeting",
  "termination",
  "other",
] as const;

export type GoldStandardConceptKind =
  (typeof GOLD_STANDARD_CONCEPT_KINDS)[number];

export const COMPARE_ALIGNMENT_KINDS = [
  "1:1",
  "1:n",
  "n:1",
  "gold_only",
  "ai_only",
] as const;

export type CompareAlignmentKind = (typeof COMPARE_ALIGNMENT_KINDS)[number];

export type CompareTextSegment = {
  text: string;
  mark: CompareTextMark;
};

export type GoldStandardConcept = {
  id: string;
  heading: string;
  body: string;
  kind: GoldStandardConceptKind;
  sortOrder: number;
};

export type AiMinutesConcept = {
  id: string;
  heading: string;
  body: string;
  kind: GoldStandardConceptKind;
  sortOrder: number;
  sectionLabel?: string;
  agendaItemIds: string[];
};

export type CompareAlignment = {
  id: string;
  kind: CompareAlignmentKind;
  goldConceptIds: string[];
  aiConceptIds: string[];
  confidence: "high" | "medium" | "low";
  label: string;
};

export type ComparePair = {
  alignmentId: string;
  pairScore: number;
  goldSegments: CompareTextSegment[];
  aiSegments: CompareTextSegment[];
  findings: ValidationFinding[];
};

export type GoldStandardCompareDocument = {
  goldConcepts: GoldStandardConcept[];
  aiConcepts: AiMinutesConcept[];
  alignments: CompareAlignment[];
  pairs: ComparePair[];
};

export type GoldStandardValidationResult = {
  schemaVersion: GoldStandardSchemaVersion;
  analyzedAt: string;
  validationScore: number;
  scoreRationale: string;
  generatedOnly: ValidationFinding[];
  goldOnly: ValidationFinding[];
  noSignificantDifferences?: boolean;
  compare?: GoldStandardCompareDocument;
};

export type ValidateGoldStandardValidationResult = {
  value: GoldStandardValidationResult | null;
  warnings: string[];
  errors: string[];
};

export function newFindingId(): string {
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

function normalizeConceptKind(raw: unknown): GoldStandardConceptKind {
  const value = asString(raw).toLowerCase().replace(/-/g, "_");
  if ((GOLD_STANDARD_CONCEPT_KINDS as readonly string[]).includes(value)) {
    return value as GoldStandardConceptKind;
  }
  return "agenda_item";
}

function normalizeAlignmentKind(raw: unknown): CompareAlignmentKind {
  const value = asString(raw).toLowerCase();
  if (value === "1:1" || value === "1:n" || value === "n:1") return value;
  if (value === "gold_only" || value === "gold-only") return "gold_only";
  if (value === "ai_only" || value === "ai-only" || value === "generated_only") {
    return "ai_only";
  }
  return "1:1";
}

function normalizeTextMark(raw: unknown): CompareTextMark {
  const value = asString(raw).toLowerCase();
  if ((COMPARE_TEXT_MARKS as readonly string[]).includes(value)) {
    return value as CompareTextMark;
  }
  return "same";
}

function normalizeStringIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function normalizeSegments(raw: unknown): CompareTextSegment[] {
  if (!Array.isArray(raw)) return [];
  const segments: CompareTextSegment[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const text = asString(entry.text);
    if (!text) continue;
    segments.push({
      text,
      mark: normalizeTextMark(entry.mark),
    });
  }
  return segments;
}

function normalizeGoldConcept(
  raw: unknown,
  index: number,
): GoldStandardConcept | null {
  if (!isRecord(raw)) return null;
  const heading = asString(raw.heading ?? raw.title);
  const body = asString(raw.body ?? raw.text);
  if (!heading && !body) return null;
  return {
    id: asString(raw.id) || `gold-${index + 1}`,
    heading: heading || `Concept ${index + 1}`,
    body,
    kind: normalizeConceptKind(raw.kind),
    sortOrder:
      typeof raw.sortOrder === "number" && Number.isFinite(raw.sortOrder)
        ? raw.sortOrder
        : typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order)
          ? raw.sort_order
          : index,
  };
}

function normalizeAiConcept(
  raw: unknown,
  index: number,
): AiMinutesConcept | null {
  if (!isRecord(raw)) return null;
  const heading = asString(raw.heading ?? raw.title);
  const body = asString(raw.body ?? raw.text);
  if (!heading && !body) return null;
  const sectionLabel = asString(raw.sectionLabel ?? raw.section_label);
  return {
    id: asString(raw.id) || `ai-${index + 1}`,
    heading: heading || `AI concept ${index + 1}`,
    body,
    kind: normalizeConceptKind(raw.kind),
    sortOrder:
      typeof raw.sortOrder === "number" && Number.isFinite(raw.sortOrder)
        ? raw.sortOrder
        : typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order)
          ? raw.sort_order
          : index,
    ...(sectionLabel ? { sectionLabel } : {}),
    agendaItemIds: normalizeStringIds(raw.agendaItemIds ?? raw.agenda_item_ids),
  };
}

function normalizeAlignment(
  raw: unknown,
  index: number,
): CompareAlignment | null {
  if (!isRecord(raw)) return null;
  const goldConceptIds = normalizeStringIds(
    raw.goldConceptIds ?? raw.gold_concept_ids,
  );
  const aiConceptIds = normalizeStringIds(raw.aiConceptIds ?? raw.ai_concept_ids);
  const kind = normalizeAlignmentKind(raw.kind);
  if (goldConceptIds.length === 0 && aiConceptIds.length === 0) return null;
  const confidenceRaw = asString(raw.confidence).toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";
  return {
    id: asString(raw.id) || `align-${index + 1}`,
    kind,
    goldConceptIds,
    aiConceptIds,
    confidence,
    label: asString(raw.label) || `Alignment ${index + 1}`,
  };
}

function normalizePair(
  raw: unknown,
  errors: string[],
  index: number,
): ComparePair | null {
  if (!isRecord(raw)) return null;
  const alignmentId = asString(raw.alignmentId ?? raw.alignment_id);
  if (!alignmentId) return null;
  const pairScore = clampScore(raw.pairScore ?? raw.pair_score) ?? 50;
  return {
    alignmentId,
    pairScore,
    goldSegments: normalizeSegments(raw.goldSegments ?? raw.gold_segments),
    aiSegments: normalizeSegments(raw.aiSegments ?? raw.ai_segments),
    findings: normalizeFindingsArray(
      raw.findings,
      errors,
      `pairs[${index}].findings`,
    ),
  };
}

export function normalizeCompareDocument(
  raw: unknown,
  errors: string[],
): GoldStandardCompareDocument | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    errors.push("compare must be an object.");
    return null;
  }

  const goldRaw = raw.goldConcepts ?? raw.gold_concepts;
  const goldConcepts = (Array.isArray(goldRaw) ? goldRaw : [])
    .map((entry: unknown, index: number) => normalizeGoldConcept(entry, index))
    .filter((entry): entry is GoldStandardConcept => Boolean(entry));

  const aiRaw = raw.aiConcepts ?? raw.ai_concepts;
  const aiConcepts = (Array.isArray(aiRaw) ? aiRaw : [])
    .map((entry: unknown, index: number) => normalizeAiConcept(entry, index))
    .filter((entry): entry is AiMinutesConcept => Boolean(entry));

  const alignments = (Array.isArray(raw.alignments) ? raw.alignments : [])
    .map((entry: unknown, index: number) => normalizeAlignment(entry, index))
    .filter((entry): entry is CompareAlignment => Boolean(entry));

  const pairs = (Array.isArray(raw.pairs) ? raw.pairs : [])
    .map((entry: unknown, index: number) => normalizePair(entry, errors, index))
    .filter((entry): entry is ComparePair => Boolean(entry));

  if (goldConcepts.length === 0 && aiConcepts.length === 0) {
    errors.push("compare is missing gold_concepts and ai_concepts.");
    return null;
  }

  return { goldConcepts, aiConcepts, alignments, pairs };
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

  const schemaVersionRaw = asString(raw.schema_version ?? raw.schemaVersion);
  const schemaVersion: GoldStandardSchemaVersion | "" =
    schemaVersionRaw === "compare_v2" || schemaVersionRaw === "validation_v1"
      ? schemaVersionRaw
      : "";
  if (!schemaVersion) {
    errors.push(`Unsupported schema_version: ${schemaVersionRaw || "(missing)"}.`);
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

  const compare = normalizeCompareDocument(raw.compare, errors);
  if (schemaVersion === "compare_v2" && !compare) {
    errors.push("compare_v2 requires a compare document.");
  }

  if (
    errors.length > 0 ||
    validationScore === null ||
    !analyzedAt ||
    !scoreRationale ||
    !schemaVersion
  ) {
    return { value: null, warnings, errors };
  }

  const noSignificantDifferences =
    raw.no_significant_differences === true ||
    raw.noSignificantDifferences === true;

  return {
    value: {
      schemaVersion,
      analyzedAt,
      validationScore,
      scoreRationale,
      generatedOnly,
      goldOnly,
      ...(noSignificantDifferences ? { noSignificantDifferences: true } : {}),
      ...(compare ? { compare } : {}),
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
    ...(result.compare
      ? {
          compare: {
            gold_concepts: result.compare.goldConcepts,
            ai_concepts: result.compare.aiConcepts,
            alignments: result.compare.alignments,
            pairs: result.compare.pairs.map((pair) => ({
              alignmentId: pair.alignmentId,
              pairScore: pair.pairScore,
              goldSegments: pair.goldSegments,
              aiSegments: pair.aiSegments,
              findings: pair.findings,
            })),
          },
        }
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
