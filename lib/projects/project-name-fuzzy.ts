/**
 * Fuzzy similarity for project display names.
 * Strips legal suffixes so near-spellings of the same job can cluster together.
 *
 * Keep this module free of server/db imports — it is used from client UI.
 */

/** Pairwise score at or above this joins projects into the same duplicate group. */
export const PROJECT_NAME_FUZZY_THRESHOLD = 0.78;

/** Same rules as normalizeProjectNameKey — inlined so this file stays client-safe. */
function normalizeProjectNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trailing / standalone legal-form tokens removed before scoring. */
const LEGAL_SUFFIX_TOKENS = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "lp",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "bv",
  "nv",
  "pty",
  "pvt",
  "private",
]);

/**
 * Normalize an project name for fuzzy compare: lowercase alphanumerics, then drop
 * trailing legal-form tokens (inc, ltd, llc, …) while leaving the core name.
 */
export function canonicalizeProjectNameForFuzzyMatch(
  name: string | null | undefined,
): string {
  const base = normalizeProjectNameKey(name);
  if (!base) return "";
  const tokens = base.split(" ").filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    if (!LEGAL_SUFFIX_TOKENS.has(last)) break;
    tokens.pop();
  }
  return tokens.join(" ");
}

function tokenSet(canonical: string): Set<string> {
  return new Set(canonical.split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Cheap Levenshtein ratio in [0,1] for short strings. */
function editSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 12) return 0;
  const dp = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  const dist = dp[m]![n]!;
  return 1 - dist / Math.max(m, n);
}

/**
 * Similarity of two already-canonicalized project name strings in [0, 1].
 * Uses the best of token Jaccard, character trigram Jaccard, and edit ratio.
 *
 * Skip Levenshtein when token and trigram overlap are both empty on longer
 * strings — allocating a DP matrix per pair was the project-fingerprint
 * 5-minute stall (thousands of merge cards × identity policies).
 */
export function projectCanonicalNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokenScore = jaccard(tokenSet(a), tokenSet(b));
  if (tokenScore === 1) return 1;
  const aGrams = trigrams(a);
  const bGrams = trigrams(b);
  let inter = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) inter += 1;
  }
  const union = aGrams.size + bGrams.size - inter;
  const trigramScore = union > 0 ? inter / union : 0;
  const bestSoFar = Math.max(tokenScore, trigramScore);
  const aCompact = a.replace(/\s+/g, "");
  const bCompact = b.replace(/\s+/g, "");
  if (
    bestSoFar === 0 &&
    aCompact.length > 8 &&
    bCompact.length > 8
  ) {
    return 0;
  }
  const editScore = editSimilarity(aCompact, bCompact);
  return Math.max(bestSoFar, editScore);
}

/** Similarity of two raw project names after canonicalization. */
export function projectNameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return projectCanonicalNameSimilarity(
    canonicalizeProjectNameForFuzzyMatch(a),
    canonicalizeProjectNameForFuzzyMatch(b),
  );
}

/**
 * Best similarity across primary names and aliases for two project cards.
 * Returns 0 when neither side has a usable name.
 */
export function projectNamesBestSimilarity(
  leftNames: Array<string | null | undefined>,
  rightNames: Array<string | null | undefined>,
): number {
  const left = [
    ...new Set(
      leftNames
        .map((n) => canonicalizeProjectNameForFuzzyMatch(n))
        .filter(Boolean),
    ),
  ];
  const right = [
    ...new Set(
      rightNames
        .map((n) => canonicalizeProjectNameForFuzzyMatch(n))
        .filter(Boolean),
    ),
  ];
  if (left.length === 0 || right.length === 0) return 0;
  let best = 0;
  for (const a of left) {
    for (const b of right) {
      const score = projectCanonicalNameSimilarity(a, b);
      if (score > best) best = score;
      if (best >= 1) return 1;
    }
  }
  return best;
}

/**
 * Cheap inverted-index keys for candidate generation before full similarity.
 * Includes spaced tokens and compacted 4-grams so "Studio PM" ↔ "StudioPM" still meet.
 */
export function projectFuzzyBlockingKeys(
  ...rawNames: Array<string | null | undefined>
): string[] {
  const keys = new Set<string>();
  for (const raw of rawNames) {
    const canonical = canonicalizeProjectNameForFuzzyMatch(raw);
    if (!canonical) continue;
    for (const token of canonical.split(" ")) {
      if (token.length >= 2) keys.add(`t:${token}`);
    }
    const compact = canonical.replace(/\s+/g, "");
    if (compact.length >= 4) {
      for (let i = 0; i <= compact.length - 4; i++) {
        keys.add(`g:${compact.slice(i, i + 4)}`);
      }
    } else if (compact.length > 0) {
      keys.add(`c:${compact}`);
    }
  }
  return [...keys];
}
