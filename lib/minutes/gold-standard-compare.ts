import { pairMatchScore } from "@/lib/minutes/gold-standard-item-match";
import {
  newFindingId,
  type AiMinutesConcept,
  type CompareAlignment,
  type CompareAlignmentKind,
  type ComparePair,
  type CompareTextMark,
  type CompareTextSegment,
  type GoldStandardCompareDocument,
  type GoldStandardConcept,
  type GoldStandardValidationResult,
  type ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";

function newId(prefix: string): string {
  return `${prefix}-${newFindingId()}`;
}

export function fallbackSegmentGoldText(text: string): GoldStandardConcept[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks = trimmed.split(
    /\n(?=#{1,3}\s+\S|\d+\.\s+[A-Z]|[A-Z][A-Z0-9 .,'()/&-]{12,}\s*$)/m,
  );
  const concepts: GoldStandardConcept[] = [];
  chunks.forEach((chunk, index) => {
    const lines = chunk.trim().split(/\r?\n/);
    const heading = (lines[0] ?? "")
      .replace(/^#{1,3}\s+/, "")
      .trim();
    const body = lines.slice(1).join("\n").trim() || heading;
    if (!heading && !body) return;
    concepts.push({
      id: `gold-fallback-${index + 1}`,
      heading: heading || `Gold concept ${index + 1}`,
      body,
      kind: /attendance|present/i.test(heading)
        ? "attendance"
        : /call to order/i.test(heading)
          ? "call_to_order"
          : /previous minutes/i.test(heading)
            ? "previous_minutes"
            : /adjourn|terminat/i.test(heading)
              ? "termination"
              : /next meeting/i.test(heading)
                ? "next_meeting"
                : /financial/i.test(heading)
                  ? "financial"
                  : "agenda_item",
      sortOrder: concepts.length,
    });
  });
  return concepts.length > 0
    ? concepts
    : [
        {
          id: "gold-fallback-1",
          heading: "Official minutes",
          body: trimmed,
          kind: "other",
          sortOrder: 0,
        },
      ];
}

function alignmentKindFor(
  goldCount: number,
  aiCount: number,
): CompareAlignmentKind {
  if (goldCount === 0) return "ai_only";
  if (aiCount === 0) return "gold_only";
  if (goldCount > 1 && aiCount === 1) return "n:1";
  if (goldCount === 1 && aiCount > 1) return "1:n";
  return "1:1";
}

function conceptLabel(
  gold: GoldStandardConcept[],
  ai: AiMinutesConcept[],
): string {
  return gold[0]?.heading || ai[0]?.heading || "Concept";
}

function goldAiMatchScore(
  gold: GoldStandardConcept,
  ai: AiMinutesConcept,
): number {
  return Math.max(
    pairMatchScore(gold.heading, ai.heading),
    pairMatchScore(`${gold.heading} ${gold.body}`, `${ai.heading} ${ai.body}`),
  );
}

function confidenceForScore(
  score: number,
  fallback: CompareAlignment["confidence"],
): CompareAlignment["confidence"] {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return fallback;
}

/**
 * One viewer row per AI agenda item. Packed 1:n / n:n alignments concatenate
 * sibling items (4.1(a) + 4.1(b)) into a single cell.
 */
function explodeMultiAiAlignment(
  source: CompareAlignment,
  goldRows: GoldStandardConcept[],
  aiRows: AiMinutesConcept[],
): CompareAlignment[] {
  if (aiRows.length <= 1) {
    return [
      {
        ...source,
        goldConceptIds: goldRows.map((row) => row.id),
        aiConceptIds: aiRows.map((row) => row.id),
        kind: alignmentKindFor(goldRows.length, aiRows.length),
        label: source.label || conceptLabel(goldRows, aiRows),
      },
    ];
  }

  const assignedGold = new Set<string>();
  const assignedAi = new Set<string>();
  const exploded: CompareAlignment[] = [];

  const edges = goldRows.flatMap((gold) =>
    aiRows.map((ai) => ({ gold, ai, score: goldAiMatchScore(gold, ai) })),
  );
  edges.sort((left, right) => right.score - left.score);

  for (const edge of edges) {
    if (assignedGold.has(edge.gold.id) || assignedAi.has(edge.ai.id)) continue;
    assignedGold.add(edge.gold.id);
    assignedAi.add(edge.ai.id);
    exploded.push({
      id: exploded.length === 0 ? source.id : newId("align"),
      kind: "1:1",
      goldConceptIds: [edge.gold.id],
      aiConceptIds: [edge.ai.id],
      confidence: confidenceForScore(edge.score, source.confidence),
      label: edge.ai.heading || edge.gold.heading,
    });
  }

  for (const gold of goldRows) {
    if (assignedGold.has(gold.id)) continue;
    exploded.push({
      id: newId("align"),
      kind: "gold_only",
      goldConceptIds: [gold.id],
      aiConceptIds: [],
      confidence: "high",
      label: gold.heading,
    });
    assignedGold.add(gold.id);
  }

  for (const ai of aiRows) {
    if (assignedAi.has(ai.id)) continue;
    let bestGold: GoldStandardConcept | null = null;
    let bestScore = 0;
    for (const gold of goldRows) {
      const score = goldAiMatchScore(gold, ai);
      if (score > bestScore) {
        bestScore = score;
        bestGold = gold;
      }
    }
    exploded.push(
      bestGold
        ? {
            id: newId("align"),
            kind: "1:1",
            goldConceptIds: [bestGold.id],
            aiConceptIds: [ai.id],
            confidence: confidenceForScore(bestScore, "low"),
            label: ai.heading,
          }
        : {
            id: newId("align"),
            kind: "ai_only",
            goldConceptIds: [],
            aiConceptIds: [ai.id],
            confidence: "high",
            label: ai.heading,
          },
    );
    assignedAi.add(ai.id);
  }

  return exploded;
}

export function completeAlignments(
  goldConcepts: GoldStandardConcept[],
  aiConcepts: AiMinutesConcept[],
  rawAlignments: CompareAlignment[],
): CompareAlignment[] {
  const goldById = new Map(goldConcepts.map((row) => [row.id, row]));
  const aiById = new Map(aiConcepts.map((row) => [row.id, row]));
  const usedGold = new Set<string>();
  const usedAi = new Set<string>();
  const completed: CompareAlignment[] = [];

  for (const alignment of rawAlignments) {
    const goldConceptIds = alignment.goldConceptIds.filter(
      (id) => goldById.has(id) && !usedGold.has(id),
    );
    const aiConceptIds = alignment.aiConceptIds.filter(
      (id) => aiById.has(id) && !usedAi.has(id),
    );
    if (goldConceptIds.length === 0 && aiConceptIds.length === 0) continue;
    goldConceptIds.forEach((id) => usedGold.add(id));
    aiConceptIds.forEach((id) => usedAi.add(id));
    const goldRows = goldConceptIds.map((id) => goldById.get(id)!);
    const aiRows = aiConceptIds.map((id) => aiById.get(id)!);
    completed.push(...explodeMultiAiAlignment(alignment, goldRows, aiRows));
  }

  for (const gold of goldConcepts) {
    if (usedGold.has(gold.id)) continue;
    let bestAi: AiMinutesConcept | null = null;
    let bestScore = 0;
    for (const ai of aiConcepts) {
      if (usedAi.has(ai.id)) continue;
      const score = pairMatchScore(gold.heading, ai.heading);
      if (score > bestScore) {
        bestScore = score;
        bestAi = ai;
      }
    }
    if (bestAi && bestScore >= 40) {
      usedGold.add(gold.id);
      usedAi.add(bestAi.id);
      completed.push({
        id: newId("align"),
        kind: "1:1",
        goldConceptIds: [gold.id],
        aiConceptIds: [bestAi.id],
        confidence: bestScore >= 70 ? "high" : "medium",
        label: gold.heading,
      });
      continue;
    }
    usedGold.add(gold.id);
    completed.push({
      id: newId("align"),
      kind: "gold_only",
      goldConceptIds: [gold.id],
      aiConceptIds: [],
      confidence: "high",
      label: gold.heading,
    });
  }

  for (const ai of aiConcepts) {
    if (usedAi.has(ai.id)) continue;
    completed.push({
      id: newId("align"),
      kind: "ai_only",
      goldConceptIds: [],
      aiConceptIds: [ai.id],
      confidence: "high",
      label: ai.heading,
    });
  }

  return completed;
}

export function joinConceptText(
  concepts: Array<{ heading: string; body: string }>,
): string {
  return concepts
    .map((row) => {
      const heading = row.heading.trim();
      const body = row.body.trim();
      if (heading && body && body.startsWith(heading)) return body;
      return [heading, body].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function unmatchedPair(
  alignment: CompareAlignment,
  goldConcepts: GoldStandardConcept[],
  aiConcepts: AiMinutesConcept[],
): ComparePair {
  const goldText = joinConceptText(goldConcepts);
  const aiText = joinConceptText(aiConcepts);
  if (alignment.kind === "gold_only") {
    return {
      alignmentId: alignment.id,
      pairScore: 35,
      goldSegments: goldText ? [{ text: goldText, mark: "omitted" }] : [],
      aiSegments: [],
      findings: [
        {
          id: newFindingId(),
          topic: alignment.label,
          detail:
            "Present in the gold-standard minutes with no matching AI minutes concept.",
          section: alignment.label,
          significance: "moderate",
        },
      ],
    };
  }
  return {
    alignmentId: alignment.id,
    pairScore: 45,
    goldSegments: [],
    aiSegments: aiText ? [{ text: aiText, mark: "added" }] : [],
    findings: [
      {
        id: newFindingId(),
        topic: alignment.label,
        detail:
          "Present in the AI minutes with no matching gold-standard concept.",
        section: alignment.label,
        significance: "moderate",
      },
    ],
  };
}

export function fallbackMatchedPair(
  alignment: CompareAlignment,
  goldConcepts: GoldStandardConcept[],
  aiConcepts: AiMinutesConcept[],
): ComparePair {
  const goldText = joinConceptText(goldConcepts);
  const aiText = joinConceptText(aiConcepts);
  return {
    alignmentId: alignment.id,
    pairScore: 70,
    goldSegments: goldText ? [{ text: goldText, mark: "same" }] : [],
    aiSegments: aiText ? [{ text: aiText, mark: "same" }] : [],
    findings: [],
  };
}

export function deriveBidirectionalFindings(
  compare: GoldStandardCompareDocument,
): { generatedOnly: ValidationFinding[]; goldOnly: ValidationFinding[] } {
  const generatedOnly: ValidationFinding[] = [];
  const goldOnly: ValidationFinding[] = [];
  const alignmentById = new Map(
    compare.alignments.map((row) => [row.id, row]),
  );

  for (const pair of compare.pairs) {
    const alignment = alignmentById.get(pair.alignmentId);
    if (alignment?.kind === "ai_only") {
      goldOnly.push(
        ...pair.findings.filter((finding) =>
          /gold/i.test(finding.detail) ? false : true,
        ),
      );
      generatedOnly.push(...pair.findings);
      continue;
    }
    if (alignment?.kind === "gold_only") {
      goldOnly.push(...pair.findings);
      continue;
    }
    for (const finding of pair.findings) {
      const inAi = pair.aiSegments.some(
        (segment) => segment.mark === "added" || segment.mark === "changed",
      );
      const inGold = pair.goldSegments.some(
        (segment) => segment.mark === "omitted" || segment.mark === "changed",
      );
      if (/missing from gold|not in the gold|AI minutes include/i.test(finding.detail) || (inAi && !inGold)) {
        generatedOnly.push(finding);
      } else if (
        /missing from AI|not in the AI|gold standard includes/i.test(finding.detail) ||
        (inGold && !inAi)
      ) {
        goldOnly.push(finding);
      } else if (inAi) {
        generatedOnly.push(finding);
      } else {
        goldOnly.push(finding);
      }
    }
  }

  return { generatedOnly, goldOnly };
}

export function findingsForAlignmentColumn(
  alignment: CompareAlignment,
  findings: ValidationFinding[],
  column: "gold" | "ai",
): ValidationFinding[] {
  if (alignment.kind === "ai_only") {
    return column === "ai" ? findings : [];
  }
  if (alignment.kind === "gold_only") {
    return column === "gold" ? findings : [];
  }
  return findings.filter((finding) => {
    const side = findingColumn(finding);
    return side === column || side === "both";
  });
}

export function findingColumn(
  finding: ValidationFinding,
): "gold" | "ai" | "both" {
  const detail = finding.detail;
  if (
    /missing from gold|not in the gold|AI minutes include|AI adds|AI includes|fabricat/i.test(
      detail,
    )
  ) {
    return "ai";
  }
  if (
    /missing from AI|not in the AI|gold standard includes|AI omits|gold includes/i.test(
      detail,
    )
  ) {
    return "gold";
  }
  return "both";
}

const MINUTES_BLOCK_START =
  /^(?:\*\*)?(?:MOTION\b|Seconded\b|SECONDED\b|THAT\b|Action:)/i;

/** Adjacent inline spans drop a space unless one segment still carries it. */
export function needsSpaceBetweenCompareSegments(
  previousText: string,
  nextText: string,
): boolean {
  if (!previousText || !nextText) return false;
  if (compareSegmentBoundarySeparator(previousText, nextText)) return false;
  if (/\s$/.test(previousText) || /^\s/.test(nextText)) return false;
  if (/^[.,;:!?)\]}]/.test(nextText)) return false;
  return true;
}

/** Newlines lost between spans or inside a flattened segment (common before motions). */
export function compareSegmentBoundarySeparator(
  previousText: string,
  nextText: string,
): "" | " " | "\n" | "\n\n" {
  if (!previousText || !nextText) return "";
  if (/\n\s*$/.test(previousText) || /^\s*\n/.test(nextText)) return "";

  const nextStart = nextText.trimStart();
  const prevTrimmedEnd = previousText.trimEnd();

  if (
    /[.!?]["']?$/.test(prevTrimmedEnd) &&
    MINUTES_BLOCK_START.test(nextStart)
  ) {
    return "\n\n";
  }

  if (/^(?:\*\*)?Seconded\b/i.test(nextStart) && /\bMOTION\b/i.test(previousText)) {
    return "\n";
  }

  if (/^(?:\*\*)?THAT\b/i.test(nextStart) && /\bSeconded\b/i.test(previousText)) {
    return "\n";
  }

  return "";
}

export function repairParagraphBreaksInSegmentText(text: string): string {
  return text.replace(
    /([.!?]["']?)(\s*)(?=(?:\*\*)?(?:MOTION\b|Seconded\b|THAT\b|Action:))/gi,
    (match, punct: string, space: string) =>
      space.includes("\n") ? match : `${punct}\n\n`,
  );
}

export function repairCompareSegmentBoundaries(
  segments: CompareTextSegment[],
): CompareTextSegment[] {
  if (segments.length === 0) return [];

  const repaired: CompareTextSegment[] = [
    {
      ...segments[0],
      text: repairParagraphBreaksInSegmentText(segments[0].text),
    },
  ];

  for (let index = 1; index < segments.length; index += 1) {
    const previous = repaired[repaired.length - 1];
    const current = {
      ...segments[index],
      text: segments[index].text,
    };
    const separator = compareSegmentBoundarySeparator(previous.text, current.text);
    if (separator) {
      current.text = `${separator}${current.text}`;
    } else if (needsSpaceBetweenCompareSegments(previous.text, current.text)) {
      current.text = ` ${current.text}`;
    }
    current.text = repairParagraphBreaksInSegmentText(current.text);
    repaired.push(current);
  }

  return repaired;
}

export function displaySegmentMark(
  mark: CompareTextMark,
  text: string,
): CompareTextMark {
  if (mark !== "motion" && mark !== "amount") return mark;
  const compact = text.replace(/\s+/g, " ").trim();
  if (mark === "amount" && compact.length <= 80) return "amount";
  if (mark === "motion") {
    const looksLikeMotion =
      /\b(motion|seconded|duly ratified|moved by|carried)\b/i.test(compact);
    if (looksLikeMotion && compact.length <= 420) return "motion";
  }
  return "changed";
}

export type CompareCoverage = {
  coveragePct: number;
  missingPct: number;
  extraPct: number;
  goldMass: number;
  aiMass: number;
  overlapMass: number;
  missingMass: number;
  extraMass: number;
};

function segmentMass(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((100 * part) / whole)));
}

function coverageFromMasses(options: {
  overlapMass: number;
  missingMass: number;
  extraMass: number;
  fallbackPct?: number;
}): CompareCoverage {
  const goldMass = options.overlapMass + options.missingMass;
  const aiMass = options.overlapMass + options.extraMass;
  if (goldMass <= 0 && aiMass <= 0) {
    const fallback = Math.min(100, Math.max(0, Math.round(options.fallbackPct ?? 100)));
    return {
      coveragePct: fallback,
      missingPct: 0,
      extraPct: 0,
      goldMass: 0,
      aiMass: 0,
      overlapMass: 0,
      missingMass: 0,
      extraMass: 0,
    };
  }
  const coveragePct = goldMass <= 0 ? 100 : pctOf(options.overlapMass, goldMass);
  return {
    coveragePct,
    missingPct: goldMass <= 0 ? 0 : 100 - coveragePct,
    extraPct: pctOf(options.extraMass, aiMass),
    goldMass,
    aiMass,
    overlapMass: options.overlapMass,
    missingMass: options.missingMass,
    extraMass: options.extraMass,
  };
}

function accumulateSegmentMass(
  segments: CompareTextSegment[],
  column: "gold" | "ai",
): { overlap: number; missing: number; extra: number } {
  let overlap = 0;
  let missing = 0;
  let extra = 0;
  for (const segment of segments) {
    const mass = segmentMass(segment.text);
    if (mass <= 0) continue;
    const mark = displaySegmentMark(segment.mark, segment.text);
    if (mark === "same") {
      overlap += mass;
      continue;
    }
    if (column === "gold") {
      missing += mass;
    } else {
      extra += mass;
    }
  }
  return { overlap, missing, extra };
}

export function computePairCoverage(pair: ComparePair): CompareCoverage {
  const gold = accumulateSegmentMass(pair.goldSegments, "gold");
  const ai = accumulateSegmentMass(pair.aiSegments, "ai");
  return coverageFromMasses({
    overlapMass: gold.overlap,
    missingMass: gold.missing,
    extraMass: ai.extra,
    fallbackPct: pair.pairScore,
  });
}

export function computeCompareCoverage(
  compare: GoldStandardCompareDocument,
): CompareCoverage {
  let overlapMass = 0;
  let missingMass = 0;
  let extraMass = 0;
  let fallbackSum = 0;
  for (const pair of compare.pairs) {
    const row = computePairCoverage(pair);
    overlapMass += row.overlapMass;
    missingMass += row.missingMass;
    extraMass += row.extraMass;
    fallbackSum += pair.pairScore;
  }
  return coverageFromMasses({
    overlapMass,
    missingMass,
    extraMass,
    fallbackPct:
      compare.pairs.length > 0 ? fallbackSum / compare.pairs.length : 50,
  });
}

export function scoreCompareDocument(
  compare: GoldStandardCompareDocument,
): {
  validationScore: number;
  missingPct: number;
  extraPct: number;
  scoreRationale: string;
} {
  const coverage = computeCompareCoverage(compare);
  const unmatchedGold = compare.alignments.filter((row) => row.kind === "gold_only").length;
  const unmatchedAi = compare.alignments.filter((row) => row.kind === "ai_only").length;
  const critical = compare.pairs.reduce(
    (count, pair) =>
      count + pair.findings.filter((finding) => finding.significance === "critical").length,
    0,
  );
  const matched = compare.alignments.filter(
    (row) => row.kind === "1:1" || row.kind === "1:n" || row.kind === "n:1",
  ).length;
  const extras: string[] = [];
  if (coverage.missingPct > 0) {
    extras.push(`${coverage.missingPct}% of official wording is missing from the AI minutes`);
  }
  if (coverage.extraPct > 0) {
    extras.push(`${coverage.extraPct}% of the AI minutes is extra versus official`);
  }
  const scoreRationale = [
    `The AI minutes cover ${coverage.coveragePct}% of official wording across ${compare.alignments.length} concepts (${matched} paired, ${unmatchedGold} gold-only, ${unmatchedAi} AI-only).`,
    extras.length > 0 ? extras.join("; ") + "." : "No extra or missing wording was recorded.",
    critical > 0
      ? `${critical} critical fact, motion, or amount difference${critical === 1 ? "" : "s"} ${critical === 1 ? "is" : "are"} listed in the notes.`
      : "No critical fact, motion, or amount mismatches were recorded.",
  ].join(" ");
  return {
    validationScore: coverage.coveragePct,
    missingPct: coverage.missingPct,
    extraPct: coverage.extraPct,
    scoreRationale,
  };
}

export function headlineValidationScore(
  validation: GoldStandardValidationResult,
): number {
  if (validation.compare) {
    return scoreCompareDocument(validation.compare).validationScore;
  }
  return validation.validationScore;
}
