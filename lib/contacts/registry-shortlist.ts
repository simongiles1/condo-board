/** Fuzzy / block shortlist for contact registry merge (never auto-merges). */

import {
  normalizePersonName,
  normalizePhone,
} from "@/lib/email/entity-dedup";
import {
  normalizeContactRegistryEmail,
  type ContactRegistryIncomingCard,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";

const DEFAULT_SHORTLIST_LIMIT = 8;

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizePersonName(value)
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

/** Cheap Levenshtein ratio in [0,1] for short strings. */
function editSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 8) return 0;
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

function personFullName(person: ContactRegistryPersonSummary): string {
  return [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
}

function incomingFullName(card: ContactRegistryIncomingCard): string {
  return [card.first_name, card.last_name].filter(Boolean).join(" ").trim();
}

export function scoreRegistryCandidate(
  incoming: ContactRegistryIncomingCard,
  person: ContactRegistryPersonSummary,
): number {
  let score = 0;

  const inEmail = incoming.email
    ? normalizeContactRegistryEmail(incoming.email)
    : null;
  if (inEmail) {
    for (const row of person.emails) {
      if (normalizeContactRegistryEmail(row.email) === inEmail) {
        score += 100;
        break;
      }
    }
  }

  const inPhone = incoming.phone ? normalizePhone(incoming.phone) : "";
  if (inPhone.length >= 7) {
    for (const row of person.phones) {
      if (row.phoneNormalized === inPhone) {
        score += 80;
        break;
      }
    }
  }

  const aName = normalizePersonName(incomingFullName(incoming));
  const bName = normalizePersonName(personFullName(person));
  if (aName && bName) {
    if (aName === bName) score += 60;
    else {
      const jac = jaccard(tokenSet(aName), tokenSet(bName));
      const edit = editSimilarity(aName, bName);
      score += Math.round(40 * Math.max(jac, edit));
    }
  } else if (incoming.first_name?.trim() && person.firstName?.trim()) {
    const af = normalizePersonName(incoming.first_name);
    const bf = normalizePersonName(person.firstName);
    if (af === bf) score += 8;
  }

  // Email local-part hint (shortlist only).
  if (inEmail && bName) {
    const local = inEmail.split("@")[0] ?? "";
    const compact = bName.replace(/\s+/g, "");
    if (local && compact && (local === compact || local.startsWith(afirst(incoming)))) {
      score += 5;
    }
  }

  return score;
}

function afirst(card: ContactRegistryIncomingCard): string {
  return normalizePersonName(card.first_name ?? "");
}

export type ShortlistHit = {
  person: ContactRegistryPersonSummary;
  score: number;
};

/**
 * Rank registry persons for an incoming card. Fuzzy scores only shortlist;
 * callers must send hits to AI before merging.
 */
export function shortlistRegistryCandidates(
  incoming: ContactRegistryIncomingCard,
  persons: ContactRegistryPersonSummary[],
  limit: number = DEFAULT_SHORTLIST_LIMIT,
): ShortlistHit[] {
  const scored: ShortlistHit[] = [];
  for (const person of persons) {
    const score = scoreRegistryCandidate(incoming, person);
    if (score < 8) continue;
    scored.push({ person, score });
  }
  scored.sort((a, b) => b.score - a.score || b.person.mentionWeight - a.person.mentionWeight);
  return scored.slice(0, Math.max(1, limit));
}

/** Pre-filter persons that share any blocking key with the incoming card. */
export function filterPersonsByBlockingKeys(
  incoming: ContactRegistryIncomingCard,
  persons: ContactRegistryPersonSummary[],
): ContactRegistryPersonSummary[] {
  const keySet = new Set(incoming.blockingKeys);
  if (keySet.size === 0) {
    // Name-only first: still allow fuzzy against full-name people with same first name.
    const first = incoming.first_name?.trim()
      ? normalizePersonName(incoming.first_name)
      : null;
    if (!first) return [];
    return persons.filter(
      (p) =>
        p.firstName &&
        normalizePersonName(p.firstName) === first &&
        !p.sparseStub,
    );
  }

  return persons.filter((person) => {
    for (const email of person.emails) {
      if (keySet.has(`email:${normalizeContactRegistryEmail(email.email)}`)) {
        return true;
      }
    }
    for (const phone of person.phones) {
      if (keySet.has(`phone:${phone.phoneNormalized}`)) return true;
    }
    if (person.firstName && person.lastName) {
      const nameKey = `name:${normalizePersonName(person.lastName)}|${normalizePersonName(person.firstName)}`;
      if (keySet.has(nameKey)) return true;
    }
    return false;
  });
}

export function shortlistAgainstRegistry(
  incoming: ContactRegistryIncomingCard,
  persons: ContactRegistryPersonSummary[],
  limit: number = DEFAULT_SHORTLIST_LIMIT,
): ShortlistHit[] {
  const blocked = filterPersonsByBlockingKeys(incoming, persons);
  const pool = blocked.length > 0 ? blocked : persons;
  return shortlistRegistryCandidates(incoming, pool, limit);
}
