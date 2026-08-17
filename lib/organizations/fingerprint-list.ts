/** Aggregate organization fingerprint merges for the Entities → Organizations tab. */

import { desc, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  organizationFingerprintMerges,
  organizationHighlightExtractions,
} from "@/lib/db/schema";
import {
  coalesceOrgEntityCards,
  entityCardDisplayName,
  parseOrgFingerprintResult,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  applyOrgFieldDenialsToCards,
  loadOrganizationFieldDenials,
  orgIdentityKey,
  stripDeniedFieldsFromOrgCard,
  type OrgFieldDenial,
} from "@/lib/organizations/field-denials";
import {
  loadOrganizationMergeMap,
  resolveOrgSurvivorKey,
} from "@/lib/organizations/manual-merge";
import {
  foldOrgNames,
  mergeOrgMultiValues,
} from "@/lib/organizations/org-multi-values";
import {
  sortOrgFingerprintSummaries,
  type OrgFingerprintListSort,
} from "@/lib/organizations/org-list-sort";
import {
  buildOrgDuplicateGroups,
  type OrgDuplicateGroup,
} from "@/lib/organizations/duplicate-groups";

export type { OrgFingerprintListSort } from "@/lib/organizations/org-list-sort";
export { parseOrgFingerprintListSort } from "@/lib/organizations/org-list-sort";

export type OrgFingerprintSummary = OrgEntityCard & {
  /** Stable key: email, else normalized name, else synthetic. */
  id: string;
  displayName: string;
  /** Variant names from absorbed orgs / coalesce (always defined on summaries). */
  aliases: string[];
  /** Thread merges that contributed evidence for this org. */
  sourceMergeCount: number;
  /** Distinct source email ids across contributing merges. */
  sourceEmailCount: number;
  modelIds: string[];
};

export type OrgFingerprintListStats = {
  organizationCount: number;
  mergeCount: number;
  emailCount: number;
};

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

/**
 * Fold two org summaries. Prefer `a`'s name as canonical (caller seeds with the
 * survivor); the other name becomes an alias. Emails / phones / websites append.
 */
function foldOrgSummaries(
  a: OrgFingerprintSummary,
  b: OrgFingerprintSummary,
  survivorId: string,
): OrgFingerprintSummary {
  const foldedNames = foldOrgNames({
    preferredName: a.name,
    otherName: b.name,
    preferredAliases: a.aliases,
    otherAliases: b.aliases,
  });
  const organization_role = preferString(
    a.organization_role,
    b.organization_role,
  );
  const email = mergeOrgMultiValues("email", a.email, b.email);
  const phone = mergeOrgMultiValues("phone", a.phone, b.phone);
  const website = mergeOrgMultiValues("website", a.website, b.website);
  const card = {
    name: foldedNames.name,
    organization_role,
    email,
    phone,
    website,
    aliases: foldedNames.aliases,
  };
  return {
    ...card,
    id: survivorId,
    displayName: entityCardDisplayName(card),
    aliases: foldedNames.aliases,
    sourceMergeCount: a.sourceMergeCount + b.sourceMergeCount,
    sourceEmailCount: a.sourceEmailCount + b.sourceEmailCount,
    modelIds: [...new Set([...a.modelIds, ...b.modelIds])],
  };
}

function applyOrganizationManualMerges(
  organizations: OrgFingerprintSummary[],
  mergeMap: Map<string, string>,
): OrgFingerprintSummary[] {
  if (mergeMap.size === 0) return organizations;

  const buckets = new Map<string, OrgFingerprintSummary[]>();
  for (const org of organizations) {
    const survivorId = resolveOrgSurvivorKey(org.id, mergeMap);
    const list = buckets.get(survivorId) ?? [];
    list.push(org);
    buckets.set(survivorId, list);
  }

  const out: OrgFingerprintSummary[] = [];
  for (const [survivorId, group] of buckets) {
    // Seed with the true survivor so its name stays primary and absorbed
    // names become aliases (e.g. Studio… → ICC).
    const seed =
      group.find((org) => org.id === survivorId) ?? group[0]!;
    let folded: OrgFingerprintSummary = {
      ...seed,
      id: survivorId,
      aliases: [...(seed.aliases ?? [])],
    };
    for (const other of group) {
      if (other.id === seed.id) continue;
      folded = foldOrgSummaries(folded, other, survivorId);
    }
    out.push(folded);
  }

  return out;
}

function applyFieldDenialsToSummaries(
  organizations: OrgFingerprintSummary[],
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): OrgFingerprintSummary[] {
  if (denials.length === 0) return organizations;

  const strippedOrgs: OrgFingerprintSummary[] = [];
  for (const org of organizations) {
    const stripped = stripDeniedFieldsFromOrgCard(org, denials, mergeMap);
    if (
      !stripped.name?.trim() &&
      !stripped.organization_role?.trim() &&
      !stripped.email?.trim() &&
      !stripped.phone?.trim() &&
      !stripped.website?.trim()
    ) {
      continue;
    }
    strippedOrgs.push({
      ...org,
      ...stripped,
      aliases: [...(stripped.aliases ?? [])],
      id: orgIdentityKey(stripped),
      displayName: entityCardDisplayName(stripped),
    });
  }

  // Severing an identity email can collapse multiple rows onto the same name key.
  const byId = new Map<string, OrgFingerprintSummary>();
  for (const org of strippedOrgs) {
    const existing = byId.get(org.id);
    if (!existing) {
      byId.set(org.id, org);
      continue;
    }
    byId.set(org.id, foldOrgSummaries(existing, org, org.id));
  }
  return [...byId.values()];
}

function parseEmailIdsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

type MergeContribution = {
  modelId: string;
  emailIds: string[];
  cards: OrgEntityCard[];
};

/**
 * Load unique organizations from pass-4 fingerprint merges across all threads,
 * coalesced by email then name (same rules as merge pass safety net).
 * Falls back to pass-3 cards when no merges exist yet.
 */
export async function loadOrgFingerprintSummaries(params?: {
  limit?: number;
  sort?: OrgFingerprintListSort;
}): Promise<{
  organizations: OrgFingerprintSummary[];
  stats: OrgFingerprintListStats;
}> {
  const limit = params?.limit ?? 500;
  const sort = params?.sort ?? "mentions-desc";
  const db = getDb();

  const mergeRows = await db
    .select()
    .from(organizationFingerprintMerges)
    .where(isNull(organizationFingerprintMerges.error))
    .orderBy(desc(organizationFingerprintMerges.updatedAt));

  const contributions: MergeContribution[] = [];
  for (const row of mergeRows) {
    const parsed = parseOrgFingerprintResult(
      (() => {
        try {
          return JSON.parse(row.entityCardsJson) as unknown;
        } catch {
          return null;
        }
      })(),
    );
    if (parsed.entity_cards.length === 0) continue;
    contributions.push({
      modelId: row.modelId,
      emailIds: parseEmailIdsJson(row.emailIdsJson),
      cards: parsed.entity_cards,
    });
  }

  let usedPass3Fallback = false;
  if (contributions.length === 0) {
    usedPass3Fallback = true;
    const thirdPassRows = await db
      .select({
        emailId: organizationHighlightExtractions.emailId,
        modelId: organizationHighlightExtractions.modelId,
        thirdPassExtractionJson:
          organizationHighlightExtractions.thirdPassExtractionJson,
      })
      .from(organizationHighlightExtractions)
      .orderBy(desc(organizationHighlightExtractions.thirdPassUpdatedAt));

    for (const row of thirdPassRows) {
      if (!row.thirdPassExtractionJson) continue;
      const parsed = parseOrgFingerprintResult(
        (() => {
          try {
            return JSON.parse(row.thirdPassExtractionJson) as unknown;
          } catch {
            return null;
          }
        })(),
      );
      if (parsed.entity_cards.length === 0) continue;
      contributions.push({
        modelId: row.modelId,
        emailIds: [row.emailId],
        cards: parsed.entity_cards,
      });
    }
  }

  const [mergeMap, denials] = await Promise.all([
    loadOrganizationMergeMap(),
    loadOrganizationFieldDenials(),
  ]);

  // Strip denied field pairs before coalesce so a severed email cannot
  // re-bucket the org under email:… on the next load / re-extract.
  const flatCards = applyOrgFieldDenialsToCards(
    contributions.flatMap((c) => c.cards),
    denials,
    mergeMap,
  );
  const uniqueCards = coalesceOrgEntityCards(flatCards).slice(0, limit);

  // Index contribution stats by identity key (raw + denial-stripped) so we
  // don't re-scan every card for every unique org (was O(orgs × cards)).
  type ContribStats = {
    emailIds: Set<string>;
    modelIds: Set<string>;
    mergeCount: number;
  };
  const statsByIdentityKey = new Map<string, ContribStats>();
  function addContribStats(key: string, contrib: MergeContribution): void {
    if (!key || key.startsWith("empty:")) return;
    let stats = statsByIdentityKey.get(key);
    if (!stats) {
      stats = {
        emailIds: new Set<string>(),
        modelIds: new Set<string>(),
        mergeCount: 0,
      };
      statsByIdentityKey.set(key, stats);
    }
    stats.mergeCount += 1;
    stats.modelIds.add(contrib.modelId);
    for (const id of contrib.emailIds) stats.emailIds.add(id);
  }

  for (const contrib of contributions) {
    // Deduplicate keys within one contribution so a contrib isn't counted
    // twice when raw and stripped keys collide.
    const keysInContrib = new Set<string>();
    for (const card of contrib.cards) {
      keysInContrib.add(orgIdentityKey(card));
      if (denials.length > 0) {
        const stripped = stripDeniedFieldsFromOrgCard(card, denials, mergeMap);
        keysInContrib.add(orgIdentityKey(stripped));
      }
    }
    for (const key of keysInContrib) addContribStats(key, contrib);
  }

  const organizations: OrgFingerprintSummary[] = uniqueCards.map((card) => {
    const key = orgIdentityKey(card);
    const stats = statsByIdentityKey.get(key);
    return {
      ...card,
      aliases: [...(card.aliases ?? [])],
      id: key,
      displayName: entityCardDisplayName(card),
      sourceMergeCount: usedPass3Fallback ? 0 : (stats?.mergeCount ?? 0),
      sourceEmailCount: stats?.emailIds.size ?? 0,
      modelIds: stats ? [...stats.modelIds] : [],
    };
  });

  const mergedOrganizations = sortOrgFingerprintSummaries(
    applyFieldDenialsToSummaries(
      applyOrganizationManualMerges(organizations, mergeMap),
      denials,
      mergeMap,
    ),
    sort,
  ).slice(0, limit);

  const allEmailIds = new Set<string>();
  for (const contrib of contributions) {
    for (const id of contrib.emailIds) allEmailIds.add(id);
  }

  return {
    organizations: mergedOrganizations,
    stats: {
      organizationCount: mergedOrganizations.length,
      mergeCount: usedPass3Fallback ? 0 : mergeRows.length,
      emailCount: allEmailIds.size,
    },
  };
}

/** Fuzzy-name duplicate clusters for the Organizations → Duplicates tab. */
export async function loadOrgDuplicateGroups(): Promise<OrgDuplicateGroup[]> {
  const { organizations } = await loadOrgFingerprintSummaries({
    limit: 2000,
    sort: "mentions-desc",
  });
  return buildOrgDuplicateGroups(organizations);
}
