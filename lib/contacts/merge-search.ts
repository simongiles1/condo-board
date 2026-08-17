/**
 * Rank merge-target search hits so a given-name query like "john"
 * prefers "John Wilson" over substring hits such as "A. Johnson".
 */

export type MergeSearchOption = {
  id: string;
  displayName: string;
  searchText: string;
  /** Tie-breaker after match quality (e.g. mention count). Higher first. */
  rankHint?: number;
};

export const MERGE_SEARCH_RESULT_LIMIT = 25;

function nameTokens(displayName: string): string[] {
  return displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Higher is better. 0 means no match (except empty query, which scores 1).
 *
 * Why token-exact beats substring: "Johnson".includes("john") is true, so a
 * naive contains() search buries "John Wilson" under every Johnson.
 */
export function scoreMergeMatch(
  option: MergeSearchOption,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const name = option.displayName.toLowerCase().trim();
  const tokens = nameTokens(option.displayName);
  const hay = option.searchText.toLowerCase();

  if (name === q) return 1000;
  if (tokens[0] === q) return 900;
  if (tokens.some((token) => token === q)) return 850;
  if (
    name.startsWith(q) &&
    (name.length === q.length || /[\s.]/.test(name[q.length] ?? ""))
  ) {
    return 800;
  }
  if (tokens.some((token) => token.startsWith(q))) return 500;
  if (name.includes(q)) return 300;
  if (hay.includes(q)) return 200;

  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3 && hay.includes(digits)) return 150;

  return 0;
}

export function rankMergeOptions<T extends MergeSearchOption>(
  options: T[],
  query: string,
  limit = MERGE_SEARCH_RESULT_LIMIT,
): T[] {
  const q = query.trim();
  const scored = options
    .map((option) => ({ option, score: scoreMergeMatch(option, q) }))
    .filter((row) => (q ? row.score > 0 : true));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.option.rankHint ?? 0) - (a.option.rankHint ?? 0) ||
      a.option.displayName.localeCompare(b.option.displayName, undefined, {
        sensitivity: "base",
      }),
  );
  return scored.slice(0, limit).map((row) => row.option);
}
