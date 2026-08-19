/** Aggregate project fingerprint merges for the Entities → Projects tab. */

import { desc, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  projectFingerprintMerges,
  projectHighlightExtractions,
} from "@/lib/db/schema";
import {
  coalesceProjectEntityCards,
  projectCardDisplayName,
  parseProjectFingerprintResult,
  type ProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";
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
  /** Thread merges that contributed evidence for this project. */
  sourceMergeCount: number;
  /** Distinct source email ids across contributing merges. */
  sourceEmailCount: number;
  modelIds: string[];
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
  a: ProjectFingerprintSummary,
  b: ProjectFingerprintSummary,
  survivorId: string,
): ProjectFingerprintSummary {
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
  return {
    ...card,
    id: survivorId,
    displayName: projectCardDisplayName(card),
    aliases: foldedNames.aliases,
    sourceMergeCount: a.sourceMergeCount + b.sourceMergeCount,
    sourceEmailCount: a.sourceEmailCount + b.sourceEmailCount,
    modelIds: [...new Set([...a.modelIds, ...b.modelIds])],
  };
}

function applyProjectManualMerges(
  projects: ProjectFingerprintSummary[],
  mergeMap: Map<string, string>,
): ProjectFingerprintSummary[] {
  if (mergeMap.size === 0) return projects;

  const buckets = new Map<string, ProjectFingerprintSummary[]>();
  for (const project of projects) {
    const survivorId = resolveProjectSurvivorKey(project.id, mergeMap);
    const list = buckets.get(survivorId) ?? [];
    list.push(project);
    buckets.set(survivorId, list);
  }

  const out: ProjectFingerprintSummary[] = [];
  for (const [survivorId, group] of buckets) {
    const seed = group.find((p) => p.id === survivorId) ?? group[0]!;
    let folded: ProjectFingerprintSummary = {
      ...seed,
      id: survivorId,
      aliases: [...(seed.aliases ?? [])],
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
  projects: ProjectFingerprintSummary[],
  denials: ProjectFieldDenial[],
  mergeMap: Map<string, string>,
): ProjectFingerprintSummary[] {
  if (denials.length === 0) return projects;

  const strippedProjects: ProjectFingerprintSummary[] = [];
  for (const project of projects) {
    const stripped = stripDeniedFieldsFromProjectCard(project, denials, mergeMap);
    if (
      !stripped.name?.trim() &&
      !stripped.year_hint?.trim() &&
      !stripped.phase?.trim() &&
      !stripped.contractor?.trim() &&
      !stripped.location?.trim() &&
      !stripped.equipment_mentions?.trim()
    ) {
      continue;
    }
    strippedProjects.push({
      ...project,
      ...stripped,
      aliases: [...(stripped.aliases ?? [])],
      id: projectIdentityKey(stripped),
      displayName: projectCardDisplayName(stripped),
    });
  }

  const byId = new Map<string, ProjectFingerprintSummary>();
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

async function getProjectFingerprintPayload(): Promise<ProjectFingerprintCachePayload> {
  const cached = globalForProjectFingerprints.projectFingerprintCache;
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (cached) {
    if (!globalForProjectFingerprints.projectFingerprintInflight) {
      void startProjectFingerprintRebuild();
    }
    return cached.payload;
  }
  if (globalForProjectFingerprints.projectFingerprintInflight) {
    return globalForProjectFingerprints.projectFingerprintInflight;
  }
  return startProjectFingerprintRebuild();
}

/**
 * Load unique projects from pass-4 fingerprint merges across all threads,
 * coalesced by name+year (same rules as merge pass safety net).
 * Falls back to pass-3 cards when no merges exist yet.
 */
export async function loadProjectFingerprintSummaries(params?: {
  limit?: number;
  sort?: ProjectFingerprintListSort;
}): Promise<{
  projects: ProjectFingerprintSummary[];
  stats: ProjectFingerprintListStats;
}> {
  const limit = params?.limit ?? 500;
  const sort = params?.sort ?? "mentions-desc";
  const payload = await getProjectFingerprintPayload();
  const projects = sortProjectFingerprintSummaries(payload.projects, sort).slice(
    0,
    limit,
  );
  return {
    projects,
    stats: {
      projectCount: projects.length,
      mergeCount: payload.mergeCount,
      emailCount: payload.emailCount,
    },
  };
}

async function computeAllProjectFingerprintSummaries(): Promise<ProjectFingerprintCachePayload> {
  const db = getDb();

  const mergeRows = await db
    .select()
    .from(projectFingerprintMerges)
    .where(isNull(projectFingerprintMerges.error))
    .orderBy(desc(projectFingerprintMerges.updatedAt));

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
        emailId: projectHighlightExtractions.emailId,
        modelId: projectHighlightExtractions.modelId,
        thirdPassExtractionJson:
          projectHighlightExtractions.thirdPassExtractionJson,
      })
      .from(projectHighlightExtractions)
      .orderBy(desc(projectHighlightExtractions.thirdPassUpdatedAt));

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
      if (parsed.entity_cards.length === 0) continue;
      contributions.push({
        modelId: row.modelId,
        emailIds: [row.emailId],
        cards: parsed.entity_cards,
      });
    }
  }

  const [mergeMap, denials] = await Promise.all([
    loadProjectMergeMap(),
    loadProjectFieldDenials(),
  ]);

  const flatCards = applyProjectFieldDenialsToCards(
    contributions.flatMap((c) => c.cards),
    denials,
    mergeMap,
  );
  const uniqueCards = coalesceProjectEntityCards(flatCards);

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
    const keysInContrib = new Set<string>();
    for (const card of contrib.cards) {
      keysInContrib.add(projectIdentityKey(card));
      if (denials.length > 0) {
        const stripped = stripDeniedFieldsFromProjectCard(
          card,
          denials,
          mergeMap,
        );
        keysInContrib.add(projectIdentityKey(stripped));
      }
    }
    for (const key of keysInContrib) addContribStats(key, contrib);
  }

  const projects: ProjectFingerprintSummary[] = uniqueCards.map((card) => {
    const key = projectIdentityKey(card);
    const stats = statsByIdentityKey.get(key);
    return {
      ...card,
      aliases: [...(card.aliases ?? [])],
      id: key,
      displayName: projectCardDisplayName(card),
      sourceMergeCount: usedPass3Fallback ? 0 : (stats?.mergeCount ?? 0),
      sourceEmailCount: stats?.emailIds.size ?? 0,
      modelIds: stats ? [...stats.modelIds] : [],
    };
  });

  const mergedProjects = applyFieldDenialsToSummaries(
    applyProjectManualMerges(projects, mergeMap),
    denials,
    mergeMap,
  );

  const allEmailIds = new Set<string>();
  for (const contrib of contributions) {
    for (const id of contrib.emailIds) allEmailIds.add(id);
  }

  return {
    projects: mergedProjects,
    mergeCount: usedPass3Fallback ? 0 : mergeRows.length,
    emailCount: allEmailIds.size,
  };
}

/** Fuzzy-name duplicate clusters for the Projects → Duplicates tab. */
export async function loadProjectDuplicateGroups(): Promise<
  ProjectDuplicateGroup[]
> {
  const { projects } = await loadProjectFingerprintSummaries({
    limit: 2000,
    sort: "mentions-desc",
  });
  return buildProjectDuplicateGroups(projects);
}
