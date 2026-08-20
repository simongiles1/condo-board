/** Aggregate project fingerprint merges for the Entities → Projects tab. */

import { desc, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  projectFingerprintMerges,
  projectHighlightExtractions,
} from "@/lib/db/schema";
import {
  cardPassesNameMintingGate,
  coalesceProjectEntityCards,
  filterMintedProjectCards,
  preferProjectScope,
  projectCardDisplayName,
  parseProjectFingerprintResult,
  resolveProjectScope,
  type ProjectEntityCard,
  type ProjectScope,
} from "@/lib/email-analysis/project-highlight-shared";
import { loadOrganizationIdentityNameKeys } from "@/lib/projects/org-identity-keys";
import {
  applyProjectFieldDenialsToCards,
  loadProjectFieldDenials,
  projectIdentityKey,
  stripDeniedFieldsFromProjectCard,
  type ProjectFieldDenial,
} from "@/lib/projects/field-denials";
import {
  loadProjectMergeMap,
  resolveProjectSurvivorKey,
} from "@/lib/projects/manual-merge";
import {
  foldProjectNames,
  mergeProjectMultiValues,
} from "@/lib/projects/project-multi-values";
import {
  sortProjectFingerprintSummaries,
  type ProjectFingerprintListSort,
} from "@/lib/projects/project-list-sort";
import {
  buildProjectDuplicateGroups,
  type ProjectDuplicateGroup,
} from "@/lib/projects/duplicate-groups";

export type { ProjectFingerprintListSort } from "@/lib/projects/project-list-sort";
export { parseProjectFingerprintListSort } from "@/lib/projects/project-list-sort";

export type ProjectFingerprintSummary = ProjectEntityCard & {
  /** Stable key: name+year when present, else name, else synthetic. */
  id: string;
  displayName: string;
  /** Variant names from absorbed projects / coalesce (always defined on summaries). */
  aliases: string[];
  scope: ProjectScope | null;
  /** Thread merges that contributed evidence for this project. */
  sourceMergeCount: number;
  /** Distinct source email ids across contributing merges. */
  sourceEmailCount: number;
  modelIds: string[];
};

type ProjectSummaryBuild = ProjectFingerprintSummary & {
  emailIds: Set<string>;
};

export type ProjectFingerprintListStats = {
  projectCount: number;
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
 * Fold two project summaries. Prefer `a`'s name as canonical (caller seeds with
 * the survivor); the other name becomes an alias. Contractor / location /
 * equipment append.
 */
function foldProjectSummaries(
  a: ProjectSummaryBuild,
  b: ProjectSummaryBuild,
  survivorId: string,
): ProjectSummaryBuild {
  const foldedNames = foldProjectNames({
    preferredName: a.name,
    otherName: b.name,
    preferredAliases: a.aliases,
    otherAliases: b.aliases,
  });
  const card = {
    name: foldedNames.name,
    year_hint: preferString(a.year_hint, b.year_hint),
    phase: preferString(a.phase, b.phase),
    contractor: mergeProjectMultiValues(a.contractor, b.contractor),
    location: mergeProjectMultiValues(a.location, b.location),
    equipment_mentions: mergeProjectMultiValues(
      a.equipment_mentions,
      b.equipment_mentions,
    ),
    aliases: foldedNames.aliases,
  };
  const scope = preferProjectScope(
    resolveProjectScope(a),
    resolveProjectScope(b),
  );
  const emailIds = new Set([...a.emailIds, ...b.emailIds]);
  return {
    ...card,
    scope,
    id: survivorId,
    displayName: projectCardDisplayName({ ...card, scope }),
    aliases: foldedNames.aliases,
    sourceMergeCount: a.sourceMergeCount + b.sourceMergeCount,
    emailIds,
    sourceEmailCount: emailIds.size,
    modelIds: [...new Set([...a.modelIds, ...b.modelIds])],
  };
}

function toPublicSummary(project: ProjectSummaryBuild): ProjectFingerprintSummary {
  const scope = resolveProjectScope(project);
  return {
    id: project.id,
    displayName: project.displayName,
    name: project.name,
    year_hint: project.year_hint,
    phase: project.phase,
    contractor: project.contractor,
    location: project.location,
    equipment_mentions: project.equipment_mentions,
    scope,
    aliases: project.aliases,
    sourceMergeCount: project.sourceMergeCount,
    sourceEmailCount: project.emailIds.size,
    modelIds: project.modelIds,
  };
}

function applyProjectManualMerges(
  projects: ProjectSummaryBuild[],
  mergeMap: Map<string, string>,
): ProjectSummaryBuild[] {
  if (mergeMap.size === 0) return projects;

  const buckets = new Map<string, ProjectSummaryBuild[]>();
  for (const project of projects) {
    const survivorId = resolveProjectSurvivorKey(project.id, mergeMap);
    const list = buckets.get(survivorId) ?? [];
    list.push(project);
    buckets.set(survivorId, list);
  }

  const out: ProjectSummaryBuild[] = [];
  for (const [survivorId, group] of buckets) {
    const seed = group.find((p) => p.id === survivorId) ?? group[0]!;
    let folded: ProjectSummaryBuild = {
      ...seed,
      id: survivorId,
      aliases: [...(seed.aliases ?? [])],
      emailIds: new Set(seed.emailIds),
    };
    for (const other of group) {
      if (other.id === seed.id) continue;
      folded = foldProjectSummaries(folded, other, survivorId);
    }
    out.push(folded);
  }

  return out;
}

function applyFieldDenialsToSummaries(
  projects: ProjectSummaryBuild[],
  denials: ProjectFieldDenial[],
  mergeMap: Map<string, string>,
  orgNameKeys: ReadonlySet<string>,
): ProjectSummaryBuild[] {
  if (denials.length === 0) {
    return projects.filter((project) =>
      cardPassesNameMintingGate(project, orgNameKeys),
    );
  }

  const strippedProjects: ProjectSummaryBuild[] = [];
  for (const project of projects) {
    const stripped = stripDeniedFieldsFromProjectCard(project, denials, mergeMap);
    if (!cardPassesNameMintingGate(stripped, orgNameKeys)) continue;
    strippedProjects.push({
      ...project,
      ...stripped,
      aliases: [...(stripped.aliases ?? [])],
      id: projectIdentityKey(stripped),
      displayName: projectCardDisplayName(stripped),
      emailIds: new Set(project.emailIds),
    });
  }

  const byId = new Map<string, ProjectSummaryBuild>();
  for (const project of strippedProjects) {
    const existing = byId.get(project.id);
    if (!existing) {
      byId.set(project.id, project);
      continue;
    }
    byId.set(project.id, foldProjectSummaries(existing, project, project.id));
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
  cards: ProjectEntityCard[];
};

/** How often a background rebuild may run. Stale payloads stay until then. */
const PROJECT_FINGERPRINT_CACHE_TTL_MS = 30 * 60_000;

type ProjectFingerprintCachePayload = {
  projects: ProjectFingerprintSummary[];
  emailIdsByProjectId: Record<string, string[]>;
  /** Merge-thread email ids (for evidence body search). */
  candidateEmailIdsByProjectId: Record<string, string[]>;
  mergeCount: number;
  emailCount: number;
};

const globalForProjectFingerprints = globalThis as unknown as {
  projectFingerprintCache?: {
    expiresAt: number;
    payload: ProjectFingerprintCachePayload;
  };
  projectFingerprintInflight?: Promise<ProjectFingerprintCachePayload>;
  projectFingerprintGeneration?: number;
};

/** Drop the in-memory project list after merges or severs. */
export function invalidateProjectFingerprintSummariesCache() {
  globalForProjectFingerprints.projectFingerprintGeneration =
    (globalForProjectFingerprints.projectFingerprintGeneration ?? 0) + 1;
  globalForProjectFingerprints.projectFingerprintCache = undefined;
}

function startProjectFingerprintRebuild(): Promise<ProjectFingerprintCachePayload> {
  const generation =
    globalForProjectFingerprints.projectFingerprintGeneration ?? 0;
  const started = Date.now();
  const pending = computeAllProjectFingerprintSummaries()
    .then((payload) => {
      console.info("[entities:project-fingerprints]", {
        cache: "rebuild",
        ms: Date.now() - started,
        projects: payload.projects.length,
        merges: payload.mergeCount,
        emails: payload.emailCount,
      });
      if (
        (globalForProjectFingerprints.projectFingerprintGeneration ?? 0) ===
        generation
      ) {
        globalForProjectFingerprints.projectFingerprintCache = {
          payload,
          expiresAt: Date.now() + PROJECT_FINGERPRINT_CACHE_TTL_MS,
        };
      }
      if (globalForProjectFingerprints.projectFingerprintInflight === pending) {
        globalForProjectFingerprints.projectFingerprintInflight = undefined;
      }
      return payload;
    })
    .catch((error: unknown) => {
      if (globalForProjectFingerprints.projectFingerprintInflight === pending) {
        globalForProjectFingerprints.projectFingerprintInflight = undefined;
      }
      throw error;
    });

  globalForProjectFingerprints.projectFingerprintInflight = pending;
  return pending;
}

function payloadHasSourceEmailIndex(
  payload: ProjectFingerprintCachePayload,
): boolean {
  return (
    payload.emailIdsByProjectId != null &&
    payload.candidateEmailIdsByProjectId != null
  );
}

async function getProjectFingerprintPayload(): Promise<ProjectFingerprintCachePayload> {
  const cached = globalForProjectFingerprints.projectFingerprintCache;
  if (cached && !payloadHasSourceEmailIndex(cached.payload)) {
    globalForProjectFingerprints.projectFingerprintCache = undefined;
  }
  const fresh = globalForProjectFingerprints.projectFingerprintCache;
  if (fresh && fresh.expiresAt > Date.now()) return fresh.payload;
  if (fresh) {
    if (!globalForProjectFingerprints.projectFingerprintInflight) {
      void startProjectFingerprintRebuild();
    }
    return fresh.payload;
  }
  if (globalForProjectFingerprints.projectFingerprintInflight) {
    return globalForProjectFingerprints.projectFingerprintInflight;
  }
  return startProjectFingerprintRebuild();
}

/** Email ids that make up a project's source-email count. */
export async function listProjectSourceEmailIds(
  projectId: string,
): Promise<string[]> {
  const id = projectId.trim();
  if (!id) return [];
  const payload = await getProjectFingerprintPayload();
  return payload.emailIdsByProjectId?.[id] ?? [];
}

/** Merge-thread + pass-3 emails to scan for work-name evidence. */
export async function listProjectEvidenceCandidateEmailIds(
  projectId: string,
): Promise<string[]> {
  const id = projectId.trim();
  if (!id) return [];
  const payload = await getProjectFingerprintPayload();
  const attributed = payload.emailIdsByProjectId?.[id] ?? [];
  const candidates = payload.candidateEmailIdsByProjectId?.[id] ?? [];
  return [...new Set([...attributed, ...candidates])];
}

/**
 * Load unique projects from pass-4 fingerprint merges across all threads,
 * coalesced by name+year (same rules as merge pass safety net).
 * Falls back to pass-3 cards when no merges exist yet.
 */
export async function loadProjectFingerprintSummaries(params?: {
  limit?: number;
  offset?: number;
  sort?: ProjectFingerprintListSort;
}): Promise<{
  projects: ProjectFingerprintSummary[];
  stats: ProjectFingerprintListStats;
}> {
  const sort = params?.sort ?? "mentions-desc";
  const offset = Math.max(0, params?.offset ?? 0);
  const payload = await getProjectFingerprintPayload();
  const sorted = sortProjectFingerprintSummaries(payload.projects, sort);
  const projects =
    params?.limit == null ? sorted.slice(offset) : sorted.slice(offset, offset + params.limit);
  return {
    projects,
    stats: {
      projectCount: payload.projects.length,
      mergeCount: payload.mergeCount,
      emailCount: payload.emailCount,
    },
  };
}

async function computeAllProjectFingerprintSummaries(): Promise<ProjectFingerprintCachePayload> {
  const db = getDb();

  const [mergeRows, thirdPassRows, mergeMap, denials, orgNameKeys] =
    await Promise.all([
      db
        .select()
        .from(projectFingerprintMerges)
        .where(isNull(projectFingerprintMerges.error))
        .orderBy(desc(projectFingerprintMerges.updatedAt)),
      db
        .select({
          emailId: projectHighlightExtractions.emailId,
          modelId: projectHighlightExtractions.modelId,
          thirdPassExtractionJson:
            projectHighlightExtractions.thirdPassExtractionJson,
        })
        .from(projectHighlightExtractions)
        .orderBy(desc(projectHighlightExtractions.thirdPassUpdatedAt)),
      loadProjectMergeMap(),
      loadProjectFieldDenials(),
      loadOrganizationIdentityNameKeys().catch(() => new Set<string>()),
    ]);

  const contributions: MergeContribution[] = [];
  for (const row of mergeRows) {
    const parsed = parseProjectFingerprintResult(
      (() => {
        try {
          return JSON.parse(row.entityCardsJson) as unknown;
        } catch {
          return null;
        }
      })(),
    );
    const cards = filterMintedProjectCards(parsed.entity_cards, orgNameKeys);
    if (cards.length === 0) continue;
    contributions.push({
      modelId: row.modelId,
      emailIds: parseEmailIdsJson(row.emailIdsJson),
      cards,
    });
  }

  let usedPass3Fallback = false;
  if (contributions.length === 0) {
    usedPass3Fallback = true;
    for (const row of thirdPassRows) {
      if (!row.thirdPassExtractionJson) continue;
      const parsed = parseProjectFingerprintResult(
        (() => {
          try {
            return JSON.parse(row.thirdPassExtractionJson) as unknown;
          } catch {
            return null;
          }
        })(),
      );
      const cards = filterMintedProjectCards(parsed.entity_cards, orgNameKeys);
      if (cards.length === 0) continue;
      contributions.push({
        modelId: row.modelId,
        emailIds: [row.emailId],
        cards,
      });
    }
  }

  const flatCards = applyProjectFieldDenialsToCards(
    contributions.flatMap((c) => c.cards),
    denials,
    mergeMap,
  );
  const uniqueCards = coalesceProjectEntityCards(flatCards, orgNameKeys);

  type ContribStats = {
    emailIds: Set<string>;
    candidateEmailIds: Set<string>;
    modelIds: Set<string>;
    mergeCount: number;
  };
  const statsByIdentityKey = new Map<string, ContribStats>();
  function ensureStats(key: string): ContribStats | null {
    if (!key || key.startsWith("empty:")) return null;
    let stats = statsByIdentityKey.get(key);
    if (!stats) {
      stats = {
        emailIds: new Set<string>(),
        candidateEmailIds: new Set<string>(),
        modelIds: new Set<string>(),
        mergeCount: 0,
      };
      statsByIdentityKey.set(key, stats);
    }
    return stats;
  }

  for (const contrib of contributions) {
    const keysInContrib = new Set<string>();
    for (const card of contrib.cards) {
      if (!cardPassesNameMintingGate(card, orgNameKeys)) continue;
      keysInContrib.add(projectIdentityKey(card));
      if (denials.length > 0) {
        const stripped = stripDeniedFieldsFromProjectCard(
          card,
          denials,
          mergeMap,
        );
        if (cardPassesNameMintingGate(stripped, orgNameKeys)) {
          keysInContrib.add(projectIdentityKey(stripped));
        }
      }
    }
    for (const key of keysInContrib) {
      const stats = ensureStats(key);
      if (!stats) continue;
      stats.mergeCount += 1;
      stats.modelIds.add(contrib.modelId);
      for (const id of contrib.emailIds) stats.candidateEmailIds.add(id);
    }
  }

  for (const row of thirdPassRows) {
    if (!row.thirdPassExtractionJson) continue;
    const parsed = parseProjectFingerprintResult(
      (() => {
        try {
          return JSON.parse(row.thirdPassExtractionJson) as unknown;
        } catch {
          return null;
        }
      })(),
    );
    const cards = applyProjectFieldDenialsToCards(
      filterMintedProjectCards(parsed.entity_cards, orgNameKeys),
      denials,
      mergeMap,
    );
    for (const card of cards) {
      if (!cardPassesNameMintingGate(card, orgNameKeys)) continue;
      const stats = ensureStats(projectIdentityKey(card));
      if (!stats) continue;
      stats.emailIds.add(row.emailId);
      stats.candidateEmailIds.add(row.emailId);
      stats.modelIds.add(row.modelId);
    }
  }

  const projects: ProjectSummaryBuild[] = uniqueCards.map((card) => {
    const key = projectIdentityKey(card);
    const stats = statsByIdentityKey.get(key);
    const emailIds = new Set(stats?.emailIds ?? []);
    return {
      ...card,
      scope: resolveProjectScope(card),
      aliases: [...(card.aliases ?? [])],
      id: key,
      displayName: projectCardDisplayName(card),
      sourceMergeCount: usedPass3Fallback ? 0 : (stats?.mergeCount ?? 0),
      emailIds,
      sourceEmailCount: emailIds.size,
      modelIds: stats ? [...stats.modelIds] : [],
    };
  });

  const mergedProjects = applyFieldDenialsToSummaries(
    applyProjectManualMerges(projects, mergeMap),
    denials,
    mergeMap,
    orgNameKeys,
  );

  const allEmailIds = new Set<string>();
  for (const contrib of contributions) {
    for (const id of contrib.emailIds) allEmailIds.add(id);
  }

  const emailIdsByProjectId: Record<string, string[]> = {};
  const candidateEmailIdsByProjectId: Record<string, string[]> = {};
  for (const project of mergedProjects) {
    const stats = statsByIdentityKey.get(project.id);
    emailIdsByProjectId[project.id] = [...project.emailIds];
    candidateEmailIdsByProjectId[project.id] = [
      ...new Set([...project.emailIds, ...(stats?.candidateEmailIds ?? [])]),
    ];
  }

  return {
    projects: mergedProjects.map(toPublicSummary),
    emailIdsByProjectId,
    candidateEmailIdsByProjectId,
    mergeCount: usedPass3Fallback ? 0 : mergeRows.length,
    emailCount: allEmailIds.size,
  };
}

/** Fuzzy-name duplicate clusters for the Projects → Duplicates tab. */
export async function loadProjectDuplicateGroups(): Promise<
  ProjectDuplicateGroup[]
> {
  const { projects } = await loadProjectFingerprintSummaries({
    sort: "mentions-desc",
  });
  return buildProjectDuplicateGroups(projects);
}
