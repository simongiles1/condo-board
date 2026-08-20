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
  applyOrgFieldAttachmentsToCards,
  loadOrganizationFieldAttachments,
  type OrgFieldAttachment,
} from "@/lib/organizations/field-attachments";
import {
  applyOrgFieldDenialsToCards,
  loadOrganizationFieldDenials,
  normalizeOrgNameKey,
  orgIdentityKey,
  stripDeniedFieldsFromOrgCard,
  type OrgFieldDenial,
} from "@/lib/organizations/field-denials";
import {
  applyResidualEmailsFromMovedIdentityBuckets,
} from "@/lib/organizations/identity-email-bucket";
import {
  applyMovedAliasEmailAttribution,
  rebuildOrgEmailIdsFromSightings,
  type OrgNameSighting,
} from "@/lib/organizations/moved-alias-attribution";
import {
  loadOrganizationMergeMap,
  resolveOrgSurvivorKey,
} from "@/lib/organizations/manual-merge";
import {
  foldOrgNames,
  mergeOrgMultiValues,
  splitOrgMultiValue,
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

type OrgSummaryBuild = OrgFingerprintSummary & { emailIds: Set<string> };

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
  a: OrgSummaryBuild,
  b: OrgSummaryBuild,
  survivorId: string,
): OrgSummaryBuild {
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
  const emailIds = new Set([...a.emailIds, ...b.emailIds]);
  return {
    ...card,
    id: survivorId,
    displayName: entityCardDisplayName(card),
    aliases: foldedNames.aliases,
    sourceMergeCount: a.sourceMergeCount + b.sourceMergeCount,
    emailIds,
    sourceEmailCount: emailIds.size,
    modelIds: [...new Set([...a.modelIds, ...b.modelIds])],
  };
}

function recountEmailIds(org: OrgSummaryBuild): OrgSummaryBuild {
  return { ...org, sourceEmailCount: org.emailIds.size };
}

function toPublicSummary(org: OrgSummaryBuild): OrgFingerprintSummary {
  const counted = recountEmailIds(org);
  return {
    id: counted.id,
    displayName: counted.displayName,
    name: counted.name,
    organization_role: counted.organization_role,
    email: counted.email,
    phone: counted.phone,
    website: counted.website,
    aliases: counted.aliases,
    sourceMergeCount: counted.sourceMergeCount,
    sourceEmailCount: counted.sourceEmailCount,
    modelIds: counted.modelIds,
  };
}

function applyOrganizationManualMerges(
  organizations: OrgSummaryBuild[],
  mergeMap: Map<string, string>,
): OrgSummaryBuild[] {
  if (mergeMap.size === 0) return organizations;

  const buckets = new Map<string, OrgSummaryBuild[]>();
  for (const org of organizations) {
    const survivorId = resolveOrgSurvivorKey(org.id, mergeMap);
    const list = buckets.get(survivorId) ?? [];
    list.push(org);
    buckets.set(survivorId, list);
  }

  const out: OrgSummaryBuild[] = [];
  for (const [survivorId, group] of buckets) {
    // Seed with the true survivor so its name stays primary and absorbed
    // names become aliases (e.g. Studio… → ICC).
    const seed =
      group.find((org) => org.id === survivorId) ?? group[0]!;
    let folded: OrgSummaryBuild = {
      ...seed,
      id: survivorId,
      aliases: [...(seed.aliases ?? [])],
      emailIds: new Set(seed.emailIds),
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
  organizations: OrgSummaryBuild[],
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): OrgSummaryBuild[] {
  if (denials.length === 0) return organizations;

  const strippedOrgs: OrgSummaryBuild[] = [];
  for (const org of organizations) {
    const stripped = stripDeniedFieldsFromOrgCard(org, denials, mergeMap);
    if (
      !stripped.name?.trim() &&
      !(stripped.aliases ?? []).some((alias) => alias.trim()) &&
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
      emailIds: new Set(org.emailIds),
    });
  }

  // Severing an identity email can collapse multiple rows onto the same name key.
  const byId = new Map<string, OrgSummaryBuild>();
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

function applyFieldAttachmentsToSummaries(
  organizations: OrgSummaryBuild[],
  attachments: OrgFieldAttachment[],
  mergeMap: Map<string, string>,
): OrgSummaryBuild[] {
  if (attachments.length === 0) return organizations;
  return organizations.map((org) => {
    const next = applyOrgFieldAttachmentsToCards(
      [org],
      attachments,
      mergeMap,
    )[0];
    if (!next) return org;
    return {
      ...org,
      ...next,
      aliases: [...(next.aliases ?? [])],
      displayName: entityCardDisplayName(next),
      id: org.id,
    };
  });
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

type ContribStats = {
  emailIds: Set<string>;
  modelIds: Set<string>;
  mergeCount: number;
};

function recoverDisplayNameForNameKey(
  nameKey: string,
  contributions: MergeContribution[],
): string | null {
  for (const contrib of contributions) {
    for (const card of contrib.cards) {
      if (normalizeOrgNameKey(card.name) === nameKey && card.name?.trim()) {
        return card.name.trim();
      }
      for (const alias of card.aliases ?? []) {
        if (normalizeOrgNameKey(alias) === nameKey && alias.trim()) {
          return alias.trim();
        }
      }
    }
  }
  return null;
}

function ensureOrgsFromMovedIdentityEmailDenials(
  organizations: OrgSummaryBuild[],
  denials: OrgFieldDenial[],
  contributions: MergeContribution[],
): OrgSummaryBuild[] {
  const byId = new Map(organizations.map((org) => [org.id, org]));
  const additions: OrgSummaryBuild[] = [];

  for (const denial of denials) {
    if (
      denial.field !== "email" ||
      !denial.nameKey ||
      !denial.orgKey.startsWith("email:")
    ) {
      continue;
    }
    const displayName = recoverDisplayNameForNameKey(
      denial.nameKey,
      contributions,
    );
    if (!displayName) continue;

    const nameCard: OrgEntityCard = {
      name: displayName,
      organization_role: null,
      email: null,
      phone: null,
      website: null,
      aliases: [],
    };
    const nameId = orgIdentityKey(nameCard);
    if (byId.has(nameId)) continue;

    const org: OrgSummaryBuild = {
      ...nameCard,
      aliases: [],
      id: nameId,
      displayName: displayName,
      sourceMergeCount: 0,
      emailIds: new Set<string>(),
      sourceEmailCount: 0,
      modelIds: [],
    };
    additions.push(org);
    byId.set(nameId, org);
  }

  if (additions.length === 0) return organizations;
  return [...organizations, ...additions];
}

function identityKeysForHarvestCard(
  card: OrgEntityCard,
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): string[] {
  const keys = new Set<string>();
  const raw = orgIdentityKey(card);
  if (raw && !raw.startsWith("empty:")) keys.add(raw);
  if (denials.length > 0) {
    const stripped = orgIdentityKey(
      stripDeniedFieldsFromOrgCard(card, denials, mergeMap),
    );
    if (stripped && !stripped.startsWith("empty:")) keys.add(stripped);
  }
  return [...keys];
}

function sightingsFromContributions(
  contributions: MergeContribution[],
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): OrgNameSighting[] {
  const out: OrgNameSighting[] = [];
  for (const contrib of contributions) {
    for (const card of contrib.cards) {
      const name = card.name?.trim();
      if (!name) continue;
      const identityKeys = identityKeysForHarvestCard(card, denials, mergeMap);
      if (identityKeys.length === 0) continue;
      for (const emailId of contrib.emailIds) {
        if (!emailId) continue;
        out.push({ emailId, name, identityKeys });
      }
    }
  }
  return out;
}

async function loadOrgPass3NameSightings(
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): Promise<OrgNameSighting[]> {
  const db = getDb();
  const rows = await db
    .select({
      emailId: organizationHighlightExtractions.emailId,
      thirdPassExtractionJson:
        organizationHighlightExtractions.thirdPassExtractionJson,
    })
    .from(organizationHighlightExtractions);

  const out: OrgNameSighting[] = [];
  for (const row of rows) {
    if (!row.thirdPassExtractionJson) continue;
    let parsed: ReturnType<typeof parseOrgFingerprintResult>;
    try {
      parsed = parseOrgFingerprintResult(
        JSON.parse(row.thirdPassExtractionJson) as unknown,
      );
    } catch {
      continue;
    }
    for (const card of parsed.entity_cards) {
      const name = card.name?.trim();
      if (!name) continue;
      const identityKeys = identityKeysForHarvestCard(card, denials, mergeMap);
      if (identityKeys.length === 0) continue;
      out.push({ emailId: row.emailId, name, identityKeys });
    }
  }
  return out;
}

async function loadMovedAliasSightings(params: {
  attachments: OrgFieldAttachment[];
  contributions: MergeContribution[];
  denials: OrgFieldDenial[];
  mergeMap: Map<string, string>;
  usedPass3Fallback: boolean;
}): Promise<OrgNameSighting[]> {
  if (!params.attachments.some((row) => row.field === "name_alias")) {
    return [];
  }
  const fromContribs = sightingsFromContributions(
    params.contributions,
    params.denials,
    params.mergeMap,
  );
  if (params.usedPass3Fallback) return fromContribs;

  const fromPass3 = await loadOrgPass3NameSightings(
    params.denials,
    params.mergeMap,
  );
  if (fromPass3.length === 0) return fromContribs;

  const pass3Emails = new Set(fromPass3.map((row) => row.emailId));
  return [
    ...fromPass3,
    ...fromContribs.filter((row) => !pass3Emails.has(row.emailId)),
  ];
}

/** How often a background rebuild may run. Stale payloads stay until then. */
const ORG_FINGERPRINT_CACHE_TTL_MS = 30 * 60_000;

type OrgFingerprintCachePayload = {
  organizations: OrgFingerprintSummary[];
  mergeCount: number;
  emailCount: number;
};

const globalForOrgFingerprints = globalThis as unknown as {
  orgFingerprintCache?: {
    expiresAt: number;
    payload: OrgFingerprintCachePayload;
  };
  orgFingerprintInflight?: Promise<OrgFingerprintCachePayload>;
  orgFingerprintGeneration?: number;
};

/** Drop the in-memory org list after merges, severs, or field moves. */
export function invalidateOrgFingerprintSummariesCache() {
  globalForOrgFingerprints.orgFingerprintGeneration =
    (globalForOrgFingerprints.orgFingerprintGeneration ?? 0) + 1;
  globalForOrgFingerprints.orgFingerprintCache = undefined;
}

function startOrgFingerprintRebuild(): Promise<OrgFingerprintCachePayload> {
  const generation = globalForOrgFingerprints.orgFingerprintGeneration ?? 0;
  const started = Date.now();
  const pending = computeAllOrgFingerprintSummaries()
    .then((payload) => {
      console.info("[entities:org-fingerprints]", {
        cache: "rebuild",
        ms: Date.now() - started,
        organizations: payload.organizations.length,
        merges: payload.mergeCount,
        emails: payload.emailCount,
      });
      if (
        (globalForOrgFingerprints.orgFingerprintGeneration ?? 0) === generation
      ) {
        globalForOrgFingerprints.orgFingerprintCache = {
          payload,
          expiresAt: Date.now() + ORG_FINGERPRINT_CACHE_TTL_MS,
        };
      }
      if (globalForOrgFingerprints.orgFingerprintInflight === pending) {
        globalForOrgFingerprints.orgFingerprintInflight = undefined;
      }
      return payload;
    })
    .catch((error: unknown) => {
      if (globalForOrgFingerprints.orgFingerprintInflight === pending) {
        globalForOrgFingerprints.orgFingerprintInflight = undefined;
      }
      throw error;
    });

  globalForOrgFingerprints.orgFingerprintInflight = pending;
  return pending;
}

async function getOrgFingerprintPayload(): Promise<OrgFingerprintCachePayload> {
  const cached = globalForOrgFingerprints.orgFingerprintCache;
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  // Keep serving the last rebuild after TTL; refresh in the background so
  // sidebar tab switches do not wait on merge JSON + pass-3 parsing.
  if (cached) {
    if (!globalForOrgFingerprints.orgFingerprintInflight) {
      void startOrgFingerprintRebuild();
    }
    return cached.payload;
  }
  if (globalForOrgFingerprints.orgFingerprintInflight) {
    return globalForOrgFingerprints.orgFingerprintInflight;
  }
  return startOrgFingerprintRebuild();
}

/**
 * Load unique organizations from pass-4 fingerprint merges across all threads,
 * coalesced by email then name (same rules as merge pass safety net).
 * Falls back to pass-3 cards when no merges exist yet.
 *
 * Rebuilds from every merge JSON + pass-3 sighting; cache + in-flight
 * coalescing keep list pages and concept-index from repeating that work.
 */
export async function loadOrgFingerprintSummaries(params?: {
  limit?: number;
  offset?: number;
  sort?: OrgFingerprintListSort;
}): Promise<{
  organizations: OrgFingerprintSummary[];
  stats: OrgFingerprintListStats;
}> {
  const sort = params?.sort ?? "mentions-desc";
  const offset = Math.max(0, params?.offset ?? 0);
  const payload = await getOrgFingerprintPayload();
  const sorted = sortOrgFingerprintSummaries(payload.organizations, sort);
  const organizations =
    params?.limit == null ? sorted.slice(offset) : sorted.slice(offset, offset + params.limit);
  return {
    organizations,
    stats: {
      organizationCount: payload.organizations.length,
      mergeCount: payload.mergeCount,
      emailCount: payload.emailCount,
    },
  };
}

async function computeAllOrgFingerprintSummaries(): Promise<OrgFingerprintCachePayload> {
  const started = Date.now();
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

  const [mergeMap, denials, attachments] = await Promise.all([
    loadOrganizationMergeMap(),
    loadOrganizationFieldDenials(),
    loadOrganizationFieldAttachments(),
  ]);

  // Strip denied field pairs before coalesce so a severed email cannot
  // re-bucket the org under email:… on the next load / re-extract.
  const flatCards = applyOrgFieldDenialsToCards(
    contributions.flatMap((c) => c.cards),
    denials,
    mergeMap,
  );
  const uniqueCards = coalesceOrgEntityCards(flatCards);

  // Index contribution stats by identity key (raw + denial-stripped) so we
  // don't re-scan every card for every unique org (was O(orgs × cards)).
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

  const organizations: OrgSummaryBuild[] = uniqueCards.map((card) => {
    const key = orgIdentityKey(card);
    const stats = statsByIdentityKey.get(key);
    return {
      ...card,
      aliases: [...(card.aliases ?? [])],
      id: key,
      displayName: entityCardDisplayName(card),
      sourceMergeCount: usedPass3Fallback ? 0 : (stats?.mergeCount ?? 0),
      emailIds: new Set(stats?.emailIds ?? []),
      sourceEmailCount: stats?.emailIds.size ?? 0,
      modelIds: stats ? [...stats.modelIds] : [],
    };
  });

  const withRecovered = ensureOrgsFromMovedIdentityEmailDenials(
    organizations,
    denials,
    contributions,
  );

  const afterDenials = applyFieldDenialsToSummaries(
    applyOrganizationManualMerges(withRecovered, mergeMap),
    denials,
    mergeMap,
  );
  const withResidualEmails = applyResidualEmailsFromMovedIdentityBuckets({
    organizations: afterDenials,
    denials,
    harvestCards: contributions.flatMap((contrib) => contrib.cards),
  });
  const withFieldMetadata = applyFieldAttachmentsToSummaries(
    withResidualEmails,
    attachments,
    mergeMap,
  );

  let countedOrgs = withFieldMetadata;
  const pass3Started = Date.now();
  if (!usedPass3Fallback) {
    const nameSightings = await loadOrgPass3NameSightings(denials, mergeMap);
    countedOrgs = rebuildOrgEmailIdsFromSightings({
      organizations: withFieldMetadata,
      nameSightings,
      attachments,
      mergeMap,
    });
  } else if (attachments.some((row) => row.field === "name_alias")) {
    const sightings = await loadMovedAliasSightings({
      attachments,
      contributions,
      denials,
      mergeMap,
      usedPass3Fallback,
    });
    countedOrgs = applyMovedAliasEmailAttribution({
      organizations: withFieldMetadata,
      attachments,
      sightings,
      mergeMap,
    });
  }

  const attributed = countedOrgs.map(toPublicSummary);

  const allEmailIds = new Set<string>();
  for (const contrib of contributions) {
    for (const id of contrib.emailIds) allEmailIds.add(id);
  }

  console.info("[entities:org-fingerprints:compute]", {
    ms: Date.now() - started,
    pass3Ms: Date.now() - pass3Started,
    merges: mergeRows.length,
    organizations: attributed.length,
    usedPass3Fallback,
  });

  return {
    organizations: attributed,
    mergeCount: usedPass3Fallback ? 0 : mergeRows.length,
    emailCount: allEmailIds.size,
  };
}

/** Fuzzy-name duplicate clusters for the Organizations → Duplicates tab. */
export async function loadOrgDuplicateGroups(): Promise<OrgDuplicateGroup[]> {
  const { organizations } = await loadOrgFingerprintSummaries({
    sort: "mentions-desc",
  });
  return buildOrgDuplicateGroups(organizations);
}
