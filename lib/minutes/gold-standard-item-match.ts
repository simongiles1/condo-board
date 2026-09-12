import type {
  GoldStandardCompareDocument,
  GoldStandardValidationResult,
  ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";

export type GoldStandardAgendaItemRef = {
  id: string;
  title: string;
  itemNumber?: string | null;
  sectionLabel?: string | null;
};

export type ItemGoldStandardFindings = {
  generatedOnly: ValidationFinding[];
  goldOnly: ValidationFinding[];
};

const MATCH_SCORE_THRESHOLD = 24;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "was",
  "were",
  "are",
  "has",
  "had",
  "not",
  "but",
  "its",
  "into",
  "upon",
]);

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeMatchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function longestSharedTokenRun(left: string[], rightJoined: string): number {
  let bestRun = 0;

  for (let start = 0; start < left.length; start += 1) {
    for (let end = left.length; end > start; end -= 1) {
      const phrase = left.slice(start, end).join(" ");
      if (phrase.length < 8 && end - start < 2) continue;
      if (rightJoined.includes(phrase)) {
        bestRun = Math.max(bestRun, end - start);
        break;
      }
    }
  }

  return bestRun;
}

export function pairMatchScore(leftText: string, rightText: string): number {
  const left = normalizeMatchText(leftText);
  const right = normalizeMatchText(rightText);
  if (!left || !right) return 0;

  let score = 0;

  if (left === right) {
    score = 100;
  } else if (left.includes(right) || right.includes(left)) {
    score = Math.round(
      (Math.min(left.length, right.length) / Math.max(left.length, right.length)) * 88,
    );
  }

  const leftTokens = tokenize(leftText);
  const rightTokens = tokenize(rightText);
  const rightJoined = rightTokens.join(" ");

  if (leftTokens.length > 0 && rightTokens.length > 0) {
    const leftSet = new Set(leftTokens);
    const overlap = rightTokens.filter((token) => leftSet.has(token)).length;
    if (overlap > 0) {
      const jaccard =
        overlap / (leftSet.size + rightTokens.length - overlap);
      score = Math.max(score, Math.round(jaccard * 100));

      const coverage = overlap / leftTokens.length;
      score = Math.max(score, Math.round(coverage * 82));
    }

    const sharedRun = longestSharedTokenRun(leftTokens, rightJoined);
    if (sharedRun >= 3) score = Math.max(score, 86);
    else if (sharedRun === 2) score = Math.max(score, 52);
  }

  return score;
}

function matchFindingToItemScore(
  finding: ValidationFinding,
  item: GoldStandardAgendaItemRef,
): number {
  const title = item.title;
  const section = finding.section ? normalizeMatchText(finding.section) : "";
  const sectionLabel = item.sectionLabel ? normalizeMatchText(item.sectionLabel) : "";
  const itemNumber = item.itemNumber ? normalizeMatchText(item.itemNumber) : "";

  let score = Math.max(
    pairMatchScore(finding.topic, title),
    pairMatchScore(finding.detail, title) * 0.92,
  );

  if (section) {
    if (sectionLabel && (sectionLabel.includes(section) || section.includes(sectionLabel))) {
      score += 18;
    }
    if (itemNumber && section.includes(itemNumber)) {
      score += 16;
    }
    if (section.includes("itemsforapproval") || section.includes("managementreport")) {
      const titleNorm = normalizeMatchText(title);
      if (
        titleNorm.includes("project") ||
        titleNorm.includes("approval") ||
        titleNorm.includes("contract") ||
        titleNorm.includes("replacement")
      ) {
        score += 8;
      }
    }
  }

  return score;
}

function assignFindingsToBestItem<T extends GoldStandardAgendaItemRef>(
  findings: ValidationFinding[],
  items: T[],
): Map<string, ValidationFinding[]> {
  const map = new Map<string, ValidationFinding[]>();

  for (const finding of findings) {
    let bestItem: T | null = null;
    let bestScore = 0;

    for (const item of items) {
      const score = matchFindingToItemScore(finding, item);
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    if (!bestItem || bestScore < MATCH_SCORE_THRESHOLD) continue;

    const existing = map.get(bestItem.id) ?? [];
    existing.push(finding);
    map.set(bestItem.id, existing);
  }

  return map;
}

function findingsFromCompareDocument(
  compare: GoldStandardCompareDocument,
  items: GoldStandardAgendaItemRef[],
): Map<string, ItemGoldStandardFindings> {
  const result = new Map<string, ItemGoldStandardFindings>();
  const aiById = new Map(compare.aiConcepts.map((row) => [row.id, row]));
  const goldById = new Map(compare.goldConcepts.map((row) => [row.id, row]));
  const alignmentById = new Map(compare.alignments.map((row) => [row.id, row]));

  function add(
    itemId: string,
    finding: ValidationFinding,
    bucket: "generatedOnly" | "goldOnly",
  ) {
    const current = result.get(itemId) ?? { generatedOnly: [], goldOnly: [] };
    current[bucket].push(finding);
    result.set(itemId, current);
  }

  function bestItemId(heading: string): string | null {
    let bestId: string | null = null;
    let bestScore = 0;
    for (const item of items) {
      const score = pairMatchScore(heading, item.title);
      if (score > bestScore) {
        bestScore = score;
        bestId = item.id;
      }
    }
    return bestScore >= MATCH_SCORE_THRESHOLD ? bestId : null;
  }

  for (const pair of compare.pairs) {
    const alignment = alignmentById.get(pair.alignmentId);
    if (!alignment) continue;
    const agendaIds = new Set<string>();
    for (const aiId of alignment.aiConceptIds) {
      for (const itemId of aiById.get(aiId)?.agendaItemIds ?? []) {
        agendaIds.add(itemId);
      }
    }
    if (agendaIds.size === 0) {
      const heading =
        goldById.get(alignment.goldConceptIds[0] ?? "")?.heading ||
        alignment.label;
      const fallbackId = bestItemId(heading);
      if (fallbackId) agendaIds.add(fallbackId);
    }
    for (const finding of pair.findings) {
      const bucket: "generatedOnly" | "goldOnly" =
        alignment.kind === "gold_only" ? "goldOnly" : "generatedOnly";
      for (const itemId of agendaIds) {
        add(itemId, finding, bucket);
      }
    }
  }

  return result;
}

export function buildGoldStandardFindingsByItemId<T extends GoldStandardAgendaItemRef>(
  items: T[],
  generatedOnly: ValidationFinding[],
  goldOnly: ValidationFinding[],
  compare?: GoldStandardCompareDocument | GoldStandardValidationResult | null,
): Map<string, ItemGoldStandardFindings> {
  const compareDoc =
    compare && "goldConcepts" in compare
      ? compare
      : compare && "compare" in compare
        ? compare.compare
        : null;
  if (compareDoc) {
    const mapped = findingsFromCompareDocument(compareDoc, items);
    const result = new Map<string, ItemGoldStandardFindings>();
    for (const [itemId, findings] of mapped) {
      if (findings.generatedOnly.length === 0 && findings.goldOnly.length === 0) {
        continue;
      }
      result.set(itemId, findings);
    }
    if (result.size > 0) return result;
  }

  const generatedByItem = assignFindingsToBestItem(generatedOnly, items);
  const goldByItem = assignFindingsToBestItem(goldOnly, items);
  const result = new Map<string, ItemGoldStandardFindings>();

  for (const item of items) {
    const generated = generatedByItem.get(item.id) ?? [];
    const gold = goldByItem.get(item.id) ?? [];
    if (generated.length === 0 && gold.length === 0) continue;
    result.set(item.id, { generatedOnly: generated, goldOnly: gold });
  }

  return result;
}
