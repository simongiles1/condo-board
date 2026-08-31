/** Closed project lifecycle statuses for badges, filters, and identity merge. */

export const PROJECT_PHASES = [
  "planning",
  "tender",
  "awarded",
  "in progress",
  "complete",
  "on hold",
  "cancelled",
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  planning: "Planning",
  tender: "Tender",
  awarded: "Awarded",
  "in progress": "In progress",
  complete: "Complete",
  "on hold": "On hold",
  cancelled: "Cancelled",
};

const PHASE_RANK: Record<ProjectPhase, number> = {
  planning: 1,
  tender: 2,
  awarded: 3,
  "in progress": 4,
  "on hold": 5,
  complete: 6,
  cancelled: 7,
};

/** Longest phrase first so "quotes are being sought" wins over "quotes". */
const PHASE_PHRASES: Array<[string, ProjectPhase]> = [
  ["inspection completed maintenance pending", "in progress"],
  ["waiting on parts", "on hold"],
  ["quotes are being sought", "tender"],
  ["scheduled for this coming spring", "in progress"],
  ["will start in the next month or two", "in progress"],
  ["work expected to begin", "in progress"],
  ["about to begin", "in progress"],
  ["construction review", "in progress"],
  ["maintenance pending", "in progress"],
  ["proposal requested", "planning"],
  ["contract signing", "awarded"],
  ["quotes received", "awarded"],
  ["getting quotes", "tender"],
  ["provide a quote", "tender"],
  ["bids received", "tender"],
  ["bid process", "tender"],
  ["bid review", "tender"],
  ["in progress", "in progress"],
  ["on hold", "on hold"],
  ["commencement", "in progress"],
  ["commencing", "in progress"],
  ["commenced", "in progress"],
  ["assessment", "planning"],
  ["inspection", "planning"],
  ["planning", "planning"],
  ["planned", "planning"],
  ["proposed", "planning"],
  ["proposals", "planning"],
  ["proposal", "planning"],
  ["scoping", "planning"],
  ["design", "planning"],
  ["quoted", "awarded"],
  ["quotes", "awarded"],
  ["quote", "awarded"],
  ["awarded", "awarded"],
  ["bidding", "tender"],
  ["tender", "tender"],
  ["bids", "tender"],
  ["bid", "tender"],
  ["rfp", "tender"],
  ["construction", "in progress"],
  ["scheduled", "in progress"],
  ["underway", "in progress"],
  ["started", "in progress"],
  ["completed", "complete"],
  ["complete", "complete"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
  ["abandoned", "cancelled"],
  ["deferred", "on hold"],
  ["paused", "on hold"],
  ["pending", "on hold"],
  ["done", "complete"],
  ["plan", "planning"],
];

function phaseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWorkPackageTokens(key: string): string {
  return key
    .replace(/\bchanging them in phases\b/g, " ")
    .replace(
      /\bphases?\s*\d+(?:\s*(?:and|&|,)?\s*(?:phase\s*)?\d+)*\b/g,
      " ",
    )
    .replace(/\bphases\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupPhase(key: string): ProjectPhase | null {
  if (!key) return null;
  const hits: ProjectPhase[] = [];
  let best: ProjectPhase | null = null;
  let bestLen = 0;
  for (const [phrase, phase] of PHASE_PHRASES) {
    if (key !== phrase && !key.includes(phrase)) continue;
    hits.push(phase);
    if (phrase.length > bestLen) {
      best = phase;
      bestLen = phrase.length;
    } else if (
      phrase.length === bestLen &&
      best &&
      PHASE_RANK[phase] > PHASE_RANK[best]
    ) {
      best = phase;
    }
  }
  if (hits.includes("cancelled")) return "cancelled";
  if (hits.includes("on hold") && !hits.includes("complete")) return "on hold";
  return best;
}

/** Map extractor prose onto the 7-status set. Work-package labels return null. */
export function normalizeProjectPhase(
  raw: string | null | undefined,
): ProjectPhase | null {
  const key = phaseKey(raw ?? "");
  if (!key) return null;
  const stripped = stripWorkPackageTokens(key);
  if (!stripped) return null;
  return lookupPhase(stripped);
}

export function projectPhaseSortRank(
  raw: string | null | undefined,
): number | null {
  const phase = normalizeProjectPhase(raw);
  return phase ? PHASE_RANK[phase] : null;
}

export function preferProjectPhase(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const left = normalizeProjectPhase(a);
  const right = normalizeProjectPhase(b);
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (left === "cancelled" || right === "cancelled") return "cancelled";
  return PHASE_RANK[left] >= PHASE_RANK[right] ? left : right;
}

export function phasesMatch(
  left: string | null | undefined,
  right: string,
): boolean {
  const canonicalRight = normalizeProjectPhase(right) ?? phaseKey(right);
  if (!canonicalRight) return false;
  const canonicalLeft = normalizeProjectPhase(left) ?? phaseKey(left ?? "");
  return canonicalLeft === canonicalRight;
}
