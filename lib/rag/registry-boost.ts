/**
 * Phase B corpus search: lexical registry matching + similarity boosts.
 *
 * Uses existing mention → registry links on the source email. Does not write
 * entity IDs onto document_chunks and does not use Pass B entity-register
 * embeddings.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  buildingEquipmentRegistry,
  equipmentMentions,
  organizationEntities,
  organizationMentions,
  projectEntities,
  projectMentions,
} from "@/lib/db/schema";
import { loadActiveEquipmentRegistryDocuments } from "@/lib/equipment/mention-resolve";
import { loadActiveOrganizationEntities } from "@/lib/organizations/registry-sync";
import { loadActiveProjectEntities } from "@/lib/projects/registry-sync";

export type RegistryKind = "project" | "equipment" | "organization";

export type RegistryCatalogEntry = {
  kind: RegistryKind;
  id: string;
  name: string;
  surfaces: string[];
};

export type MatchedRegistryEntity = {
  kind: RegistryKind;
  id: string;
  name: string;
  strength: "phrase" | "token";
  surface: string;
};

export type CorpusSearchEntityBadge = {
  kind: RegistryKind;
  id: string;
  name: string;
  boosted: boolean;
};

export type EmailRegistryLink = {
  kind: RegistryKind;
  id: string;
  name: string;
};

export type RegistryBoostableResult = {
  emailId: string | null;
  similarity: number;
  rawSimilarity?: number;
  boost?: number;
  entities?: CorpusSearchEntityBadge[];
};

export const REGISTRY_BOOST_PHRASE = 0.12;
export const REGISTRY_BOOST_TOKEN = 0.08;
const MAX_MATCHED_ENTITIES = 8;

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "this",
  "that",
  "what",
  "where",
  "when",
  "who",
  "how",
  "which",
  "did",
  "does",
  "ran",
  "run",
  "year",
  "about",
  "status",
  "update",
  "email",
]);

/** Tokens that appear on many assets; not enough by themselves to match. */
const GENERIC_TOKENS = new Set([
  "board",
  "boiler",
  "building",
  "co",
  "company",
  "contract",
  "corp",
  "corporation",
  "door",
  "doors",
  "elevator",
  "elevators",
  "fund",
  "garage",
  "general",
  "group",
  "hvac",
  "inc",
  "limited",
  "llc",
  "ltd",
  "management",
  "meeting",
  "project",
  "pump",
  "pumps",
  "quote",
  "repair",
  "repairs",
  "replacement",
  "services",
  "study",
  "system",
  "unit",
  "units",
  "water",
]);

export function normalizeRegistryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeRegistryQuery(value: string): string[] {
  return normalizeRegistryText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token));
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function hasConsecutivePhrase(queryNorm: string, surfaceTokens: string[]): boolean {
  for (let len = surfaceTokens.length; len >= 2; len--) {
    for (let start = 0; start + len <= surfaceTokens.length; start++) {
      const phraseTokens = surfaceTokens.slice(start, start + len);
      const distinctive = phraseTokens.filter(
        (token) => !GENERIC_TOKENS.has(token) && !/^\d{4}$/.test(token),
      );
      if (distinctive.length === 0) continue;
      if (containsPhrase(queryNorm, phraseTokens.join(" "))) return true;
    }
  }
  return false;
}

function uniqueSurfaces(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeRegistryText(trimmed);
    if (!key || key.length < 3 || QUERY_STOPWORDS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function hostnameFromWebsite(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const url = website.includes("://") ? website : `https://${website}`;
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

type SurfaceScore = {
  strength: "phrase" | "token";
  surface: string;
};

/**
 * Score one catalog entry against a query. Phrase beats token. Generic-only
 * overlap does not count.
 */
export function scoreRegistryEntry(
  query: string,
  entry: RegistryCatalogEntry,
): SurfaceScore | null {
  const queryNorm = normalizeRegistryText(query);
  const queryTokens = tokenizeRegistryQuery(query);
  if (!queryNorm || queryTokens.length === 0) return null;

  let best: SurfaceScore | null = null;

  for (const surface of entry.surfaces) {
    const surfaceNorm = normalizeRegistryText(surface);
    if (!surfaceNorm) continue;
    const surfaceTokens = surfaceNorm
      .split(" ")
      .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token));
    if (surfaceTokens.length === 0) continue;

    const distinctiveSurface = surfaceTokens.filter(
      (token) => !GENERIC_TOKENS.has(token),
    );
    const distinctiveQuery = queryTokens.filter(
      (token) => !GENERIC_TOKENS.has(token),
    );

    const consecutivePhrase =
      surfaceTokens.length >= 2 &&
      hasConsecutivePhrase(queryNorm, surfaceTokens);

    const phraseHit =
      queryNorm === surfaceNorm ||
      (surfaceNorm.length >= 4 && containsPhrase(queryNorm, surfaceNorm)) ||
      (queryTokens.length >= 2 &&
        surfaceTokens.length >= 2 &&
        containsPhrase(surfaceNorm, queryNorm)) ||
      consecutivePhrase;

    if (phraseHit && (distinctiveSurface.length > 0 || surfaceNorm.length >= 6)) {
      best = { strength: "phrase", surface };
      break;
    }

    const overlap = distinctiveSurface.filter((token) =>
      distinctiveQuery.includes(token),
    );
    const shortDistinctive =
      surfaceTokens.length === 1 &&
      surfaceNorm.length >= 3 &&
      surfaceNorm.length <= 4 &&
      !GENERIC_TOKENS.has(surfaceNorm) &&
      queryTokens.includes(surfaceNorm);

    const tokenHit =
      shortDistinctive ||
      (overlap.length >= 1 &&
        distinctiveSurface.length > 0 &&
        overlap.length / distinctiveSurface.length >= 0.5);

    if (tokenHit && best?.strength !== "phrase") {
      best = { strength: "token", surface };
    }
  }

  return best;
}

export function matchRegistryCatalog(
  query: string,
  catalog: RegistryCatalogEntry[],
): MatchedRegistryEntity[] {
  const scored: Array<MatchedRegistryEntity & { rank: number }> = [];
  for (const entry of catalog) {
    const hit = scoreRegistryEntry(query, entry);
    if (!hit) continue;
    scored.push({
      kind: entry.kind,
      id: entry.id,
      name: entry.name,
      strength: hit.strength,
      surface: hit.surface,
      rank: hit.strength === "phrase" ? 2 : 1,
    });
  }

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return a.name.localeCompare(b.name);
  });

  const seen = new Set<string>();
  const out: MatchedRegistryEntity[] = [];
  for (const item of scored) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: item.kind,
      id: item.id,
      name: item.name,
      strength: item.strength,
      surface: item.surface,
    });
    if (out.length >= MAX_MATCHED_ENTITIES) break;
  }
  return out;
}

export function registryBoostAmount(
  strength: MatchedRegistryEntity["strength"],
): number {
  return strength === "phrase" ? REGISTRY_BOOST_PHRASE : REGISTRY_BOOST_TOKEN;
}

export function applyRegistryBoost<T extends RegistryBoostableResult>(params: {
  results: T[];
  matchedEntities: MatchedRegistryEntity[];
  linksByEmail: Map<string, EmailRegistryLink[]>;
  limit: number;
}): Array<
  T & {
    rawSimilarity: number;
    similarity: number;
    boost: number;
    entities: CorpusSearchEntityBadge[];
  }
> {
  const matchByKey = new Map(
    params.matchedEntities.map((entity) => [
      `${entity.kind}:${entity.id}`,
      entity,
    ]),
  );

  const boosted = params.results.map((result) => {
    const links = result.emailId
      ? params.linksByEmail.get(result.emailId) ?? []
      : [];
    const entities: CorpusSearchEntityBadge[] = links.map((link) => ({
      kind: link.kind,
      id: link.id,
      name: link.name,
      boosted: matchByKey.has(`${link.kind}:${link.id}`),
    }));

    let bestStrength: MatchedRegistryEntity["strength"] | null = null;
    for (const entity of entities) {
      if (!entity.boosted) continue;
      const matched = matchByKey.get(`${entity.kind}:${entity.id}`);
      if (!matched) continue;
      if (!bestStrength || matched.strength === "phrase") {
        bestStrength = matched.strength;
      }
    }

    const boost = bestStrength ? registryBoostAmount(bestStrength) : 0;
    const rawSimilarity = result.rawSimilarity ?? result.similarity;
    const similarity = Math.min(1, Number((rawSimilarity + boost).toFixed(4)));

    return {
      ...result,
      rawSimilarity,
      similarity,
      boost,
      entities,
    };
  });

  boosted.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return (b.boost ?? 0) - (a.boost ?? 0);
  });

  return boosted.slice(0, params.limit);
}

export async function loadRegistryCatalog(): Promise<RegistryCatalogEntry[]> {
  const [projects, orgs, equipment] = await Promise.all([
    loadActiveProjectEntities(),
    loadActiveOrganizationEntities(),
    loadActiveEquipmentRegistryDocuments(),
  ]);

  const catalog: RegistryCatalogEntry[] = [];

  for (const project of projects) {
    const name = project.name?.trim();
    if (!name) continue;
    catalog.push({
      kind: "project",
      id: project.id,
      name,
      surfaces: uniqueSurfaces([name, ...project.aliases]),
    });
  }

  for (const org of orgs) {
    const name = org.name?.trim();
    if (!name) continue;
    catalog.push({
      kind: "organization",
      id: org.id,
      name,
      surfaces: uniqueSurfaces([
        name,
        org.email,
        hostnameFromWebsite(org.website),
      ]),
    });
  }

  for (const asset of equipment) {
    if (asset.status === "decommissioned") continue;
    const name = asset.canonicalName.trim();
    if (!name) continue;
    catalog.push({
      kind: "equipment",
      id: asset.id,
      name,
      surfaces: uniqueSurfaces([name, asset.id, ...asset.aliases]),
    });
  }

  return catalog;
}

export async function loadEmailRegistryLinks(
  emailIds: string[],
): Promise<Map<string, EmailRegistryLink[]>> {
  const uniqueIds = [...new Set(emailIds.filter(Boolean))];
  const linksByEmail = new Map<string, EmailRegistryLink[]>();
  if (uniqueIds.length === 0) return linksByEmail;

  const db = getDb();
  const resolvedStatuses = ["confirmed", "provisional"] as const;

  const [projectRows, orgRows, equipmentRows] = await Promise.all([
    db
      .select({
        emailId: projectMentions.sourceEmailId,
        id: projectEntities.id,
        name: projectEntities.name,
      })
      .from(projectMentions)
      .innerJoin(
        projectEntities,
        eq(projectMentions.resolvedProjectId, projectEntities.id),
      )
      .where(
        and(
          inArray(projectMentions.sourceEmailId, uniqueIds),
          isNotNull(projectMentions.resolvedProjectId),
          inArray(projectMentions.resolutionStatus, resolvedStatuses),
          eq(projectEntities.status, "active"),
        ),
      ),
    db
      .select({
        emailId: organizationMentions.sourceEmailId,
        id: organizationEntities.id,
        name: organizationEntities.name,
      })
      .from(organizationMentions)
      .innerJoin(
        organizationEntities,
        eq(organizationMentions.resolvedOrganizationId, organizationEntities.id),
      )
      .where(
        and(
          inArray(organizationMentions.sourceEmailId, uniqueIds),
          isNotNull(organizationMentions.resolvedOrganizationId),
          inArray(organizationMentions.resolutionStatus, resolvedStatuses),
          eq(organizationEntities.status, "active"),
        ),
      ),
    db
      .select({
        emailId: equipmentMentions.sourceEmailId,
        id: buildingEquipmentRegistry.id,
        name: buildingEquipmentRegistry.canonicalName,
        status: buildingEquipmentRegistry.status,
      })
      .from(equipmentMentions)
      .innerJoin(
        buildingEquipmentRegistry,
        eq(equipmentMentions.resolvedEquipmentId, buildingEquipmentRegistry.id),
      )
      .where(
        and(
          inArray(equipmentMentions.sourceEmailId, uniqueIds),
          isNotNull(equipmentMentions.resolvedEquipmentId),
          inArray(equipmentMentions.resolutionStatus, resolvedStatuses),
        ),
      ),
  ]);

  const pushLink = (emailId: string | null, link: EmailRegistryLink) => {
    if (!emailId) return;
    const existing = linksByEmail.get(emailId) ?? [];
    const key = `${link.kind}:${link.id}`;
    if (existing.some((item) => `${item.kind}:${item.id}` === key)) {
      linksByEmail.set(emailId, existing);
      return;
    }
    existing.push(link);
    linksByEmail.set(emailId, existing);
  };

  for (const row of projectRows) {
    const name = row.name?.trim();
    if (!name) continue;
    pushLink(row.emailId, { kind: "project", id: row.id, name });
  }
  for (const row of orgRows) {
    const name = row.name?.trim();
    if (!name) continue;
    pushLink(row.emailId, { kind: "organization", id: row.id, name });
  }
  for (const row of equipmentRows) {
    if (row.status === "decommissioned") continue;
    const name = row.name?.trim();
    if (!name) continue;
    pushLink(row.emailId, { kind: "equipment", id: row.id, name });
  }

  return linksByEmail;
}

export async function enrichSearchWithRegistry<
  T extends RegistryBoostableResult,
>(params: {
  query: string;
  results: T[];
  limit: number;
}): Promise<{
  results: Array<
    T & {
      rawSimilarity: number;
      similarity: number;
      boost: number;
      entities: CorpusSearchEntityBadge[];
    }
  >;
  matchedEntities: MatchedRegistryEntity[];
}> {
  if (params.results.length === 0) {
    return { results: [], matchedEntities: [] };
  }

  const catalog = await loadRegistryCatalog();
  const matchedEntities = matchRegistryCatalog(params.query, catalog);
  const emailIds = params.results
    .map((result) => result.emailId)
    .filter((id): id is string => Boolean(id));
  const linksByEmail = await loadEmailRegistryLinks(emailIds);

  return {
    results: applyRegistryBoost({
      results: params.results,
      matchedEntities,
      linksByEmail,
      limit: params.limit,
    }),
    matchedEntities,
  };
}
