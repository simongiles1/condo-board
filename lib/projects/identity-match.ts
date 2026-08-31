/**
 * Going-forward project identity: match a newly harvested card against
 * identity-review policies (span vs recurring-by-year).
 *
 * Keep this module free of server/db imports — tests and coalesce use it.
 */

import {
  projectIdentityKey,
  type ProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";
import { projectCanonicalNameSimilarity } from "@/lib/projects/project-name-fuzzy";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";
import {
  parseProjectYearRange,
  projectYearRangeIdentity,
  projectYearRangesOverlap,
} from "@/lib/projects/project-year-range";

export const PROJECT_IDENTITY_POLICY_KINDS = ["span", "recurring_year"] as const;
export type ProjectIdentityPolicyKind =
  (typeof PROJECT_IDENTITY_POLICY_KINDS)[number];

export type ProjectIdentityPolicy = {
  survivorKey: string;
  workLabel: string;
  policy: ProjectIdentityPolicyKind;
  aliases: string[];
  yearHint: string | null;
};

/** Boilerplate tokens stripped so "maglock installation" ≈ "maglock system". */
const WORK_NAME_FILLER = new Set([
  "a",
  "an",
  "and",
  "at",
  "building",
  "buildings",
  "for",
  "in",
  "install",
  "installation",
  "installed",
  "installing",
  "of",
  "project",
  "projects",
  "security",
  "system",
  "systems",
  "the",
  "to",
  "upgrade",
  "upgrades",
  "wide",
]);

const YEAR_TOKEN_RE = /^(?:19|20)\d{2}$/;

const WORK_NAME_CACHE_MAX = 20_000;
const workNameCache = new Map<string, string>();

function stemWorkToken(token: string): string {
  if (token.length >= 6 && token.endsWith("ing")) {
    const stem = token.slice(0, -3);
    if (stem.length >= 4) return stem;
  }
  if (token.length >= 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length >= 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * Work-name key for policy matching: drop years and filler words, stem
 * plurals / -ing, keep the remaining tokens spaced.
 */
export function canonicalizeProjectWorkName(
  name: string | null | undefined,
): string {
  const raw = name ?? "";
  const cached = workNameCache.get(raw);
  if (cached !== undefined) return cached;
  const base = normalizeProjectNameKey(raw);
  if (!base) {
    if (workNameCache.size >= WORK_NAME_CACHE_MAX) workNameCache.clear();
    workNameCache.set(raw, "");
    return "";
  }
  const tokens = base
    .split(" ")
    .filter(Boolean)
    .filter((token) => !YEAR_TOKEN_RE.test(token) && !WORK_NAME_FILLER.has(token))
    .map(stemWorkToken)
    .filter(Boolean);
  const result = tokens.join(" ");
  if (workNameCache.size >= WORK_NAME_CACHE_MAX) workNameCache.clear();
  workNameCache.set(raw, result);
  return result;
}

export function compactProjectWorkName(
  name: string | null | undefined,
): string {
  return canonicalizeProjectWorkName(name).replace(/\s+/g, "");
}

function workNamesEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = canonicalizeProjectWorkName(left);
  const b = canonicalizeProjectWorkName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aCompact = a.replace(/\s+/g, "");
  const bCompact = b.replace(/\s+/g, "");
  if (aCompact === bCompact) return true;
  if (Math.abs(aCompact.length - bCompact.length) > 12) return false;
  let sharedToken = false;
  const bTokens = new Set(b.split(" ").filter(Boolean));
  for (const token of a.split(" ").filter(Boolean)) {
    if (bTokens.has(token)) {
      sharedToken = true;
      break;
    }
  }
  // No shared tokens: only typos of a similar-length single token (maglok / maglock).
  if (!sharedToken && Math.abs(aCompact.length - bCompact.length) > 3) {
    return false;
  }
  return projectCanonicalNameSimilarity(a, b) >= 0.72;
}

/**
 * True when a harvested name belongs to this policy's work (label or aliases).
 * Compact prefix against the work label covers "Maglock … at Stair F".
 */
export function projectWorkNameMatchesPolicy(
  rawName: string | null | undefined,
  policy: Pick<ProjectIdentityPolicy, "workLabel" | "aliases">,
): boolean {
  if (!rawName?.trim()) return false;

  if (workNamesEquivalent(rawName, policy.workLabel)) return true;
  for (const alias of policy.aliases ?? []) {
    if (workNamesEquivalent(rawName, alias)) return true;
  }

  const cardCompact = compactProjectWorkName(rawName);
  const labelCompact = compactProjectWorkName(policy.workLabel);
  if (cardCompact && labelCompact.length >= 6) {
    if (cardCompact === labelCompact || cardCompact.startsWith(labelCompact)) {
      return true;
    }
  }
  return false;
}

function cardNames(card: {
  name?: string | null;
  aliases?: string[] | null;
}): string[] {
  const names: string[] = [];
  if (card.name?.trim()) names.push(card.name.trim());
  for (const alias of card.aliases ?? []) {
    if (alias?.trim()) names.push(alias.trim());
  }
  return names;
}

export function cardMatchesIdentityPolicy(
  card: {
    name?: string | null;
    aliases?: string[] | null;
  },
  policy: Pick<ProjectIdentityPolicy, "workLabel" | "aliases">,
): boolean {
  return cardNames(card).some((name) =>
    projectWorkNameMatchesPolicy(name, policy),
  );
}

function policyYearRange(policy: ProjectIdentityPolicy) {
  const fromHint = parseProjectYearRange(policy.yearHint);
  if (fromHint) return fromHint;
  const fromKey = policy.survivorKey.match(/\|year:([^|]+)$/);
  if (fromKey?.[1]) return parseProjectYearRange(fromKey[1]);
  return null;
}

function canonicalRecurringKey(
  policy: ProjectIdentityPolicy,
  card: Pick<ProjectEntityCard, "year_hint">,
): string {
  const nameKey = normalizeProjectNameKey(policy.workLabel);
  const yearRange = parseProjectYearRange(card.year_hint);
  if (nameKey && yearRange) {
    return `name:${nameKey}|year:${projectYearRangeIdentity(yearRange)}`;
  }
  if (nameKey) return `name:${nameKey}`;
  return projectIdentityKey(card as ProjectEntityCard);
}

function workNameBlockingKeys(canonical: string, compact: string): string[] {
  const keys = new Set<string>();
  for (const token of canonical.split(" ").filter(Boolean)) {
    if (token.length >= 2) keys.add(`t:${token}`);
  }
  if (compact.length >= 4) {
    for (let i = 0; i <= compact.length - 4; i++) {
      keys.add(`g:${compact.slice(i, i + 4)}`);
    }
  } else if (compact.length > 0) {
    keys.add(`c:${compact}`);
  }
  return [...keys];
}

function buildPolicyBlockIndex(
  policies: readonly ProjectIdentityPolicy[],
): Map<string, ProjectIdentityPolicy[]> {
  const index = new Map<string, ProjectIdentityPolicy[]>();
  function add(key: string, policy: ProjectIdentityPolicy) {
    const list = index.get(key);
    if (list) {
      if (!list.includes(policy)) list.push(policy);
      return;
    }
    index.set(key, [policy]);
  }
  for (const policy of policies) {
    const names = [policy.workLabel, ...(policy.aliases ?? [])];
    for (const name of names) {
      const canonical = canonicalizeProjectWorkName(name);
      if (!canonical) continue;
      const compact = canonical.replace(/\s+/g, "");
      for (const key of workNameBlockingKeys(canonical, compact)) {
        add(key, policy);
      }
    }
  }
  return index;
}

function candidatePoliciesForCard(
  card: {
    name?: string | null;
    aliases?: string[] | null;
  },
  blockIndex: Map<string, ProjectIdentityPolicy[]>,
): ProjectIdentityPolicy[] {
  const seen = new Set<ProjectIdentityPolicy>();
  const out: ProjectIdentityPolicy[] = [];
  for (const name of cardNames(card)) {
    const canonical = canonicalizeProjectWorkName(name);
    if (!canonical) continue;
    const compact = canonical.replace(/\s+/g, "");
    for (const key of workNameBlockingKeys(canonical, compact)) {
      for (const policy of blockIndex.get(key) ?? []) {
        if (seen.has(policy)) continue;
        seen.add(policy);
        out.push(policy);
      }
    }
  }
  return out;
}

function pickKeyFromPolicyMatches(
  card: Pick<ProjectEntityCard, "name" | "year_hint" | "aliases">,
  matches: ProjectIdentityPolicy[],
  fallback: string,
): string {
  if (matches.length === 0) return fallback;

  const span = matches.filter((policy) => policy.policy === "span");
  if (span.length > 0) return span[0]!.survivorKey;

  const recurring = matches.filter((policy) => policy.policy === "recurring_year");
  if (recurring.length === 0) return fallback;

  const cardYear = parseProjectYearRange(card.year_hint);
  if (cardYear) {
    const overlapping = recurring.filter((policy) => {
      const policyYear = policyYearRange(policy);
      return policyYear
        ? projectYearRangesOverlap(cardYear, policyYear)
        : false;
    });
    if (overlapping.length > 0) return overlapping[0]!.survivorKey;
    return canonicalRecurringKey(recurring[0]!, card);
  }

  const yearless = recurring.find((policy) => policyYearRange(policy) == null);
  if (yearless) return yearless.survivorKey;
  return canonicalRecurringKey(recurring[0]!, card);
}

function identityKeyFromPolicyPool(
  card: Pick<ProjectEntityCard, "name" | "year_hint" | "aliases">,
  pool: readonly ProjectIdentityPolicy[],
): string {
  const fallback = projectIdentityKey(card as ProjectEntityCard);
  if (pool.length === 0) return fallback;
  const matches = pool.filter((policy) => cardMatchesIdentityPolicy(card, policy));
  return pickKeyFromPolicyMatches(card, matches, fallback);
}

/**
 * Build a reusable matcher so fingerprint rebuild can remap thousands of
 * cards without re-indexing policies or repeating equivalent-name work.
 */
export function createProjectIdentityKeyFn(
  policies: readonly ProjectIdentityPolicy[],
): (card: Pick<ProjectEntityCard, "name" | "year_hint" | "aliases">) => string {
  if (policies.length === 0) {
    return (card) => projectIdentityKey(card as ProjectEntityCard);
  }

  const blockIndex = buildPolicyBlockIndex(policies);
  const memo = new Map<string, string>();

  return (card) => {
    const cacheKey = `${card.name ?? ""}\u0000${card.year_hint ?? ""}\u0000${(card.aliases ?? []).join("\u0001")}`;
    const hit = memo.get(cacheKey);
    if (hit) return hit;
    const candidates = candidatePoliciesForCard(card, blockIndex);
    const pool = candidates.length > 0 ? candidates : policies;
    const key = identityKeyFromPolicyPool(card, pool);
    memo.set(cacheKey, key);
    return key;
  };
}

/**
 * Remap a harvested card onto a reviewed survivor when it matches a policy.
 * Unreviewed cards keep Option C (name + year).
 */
export function projectIdentityKeyWithPolicies(
  card: Pick<ProjectEntityCard, "name" | "year_hint" | "aliases">,
  policies: readonly ProjectIdentityPolicy[],
): string {
  return createProjectIdentityKeyFn(policies)(card);
}
