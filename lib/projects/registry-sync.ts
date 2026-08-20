/** Sync fingerprint project summaries into durable project_entities rows. */

import { randomUUID } from "crypto";

import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectEntities } from "@/lib/db/schema";
import {
  loadProjectFingerprintSummaries,
  type ProjectFingerprintSummary,
} from "@/lib/projects/fingerprint-list";
import {
  loadProjectMergeMap,
  resolveProjectSurvivorKey,
} from "@/lib/projects/manual-merge";
import {
  parseProjectScope,
  preferProjectScope,
  resolveProjectScope,
  type ProjectScope,
} from "@/lib/email-analysis/project-highlight-shared";
import { mergeProjectMultiValues } from "@/lib/projects/project-multi-values";

export type ProjectEntityRow = {
  id: string;
  identityKey: string;
  name: string | null;
  yearHint: string | null;
  phase: string | null;
  contractor: string | null;
  location: string | null;
  equipmentMentions: string | null;
  scope: ProjectScope | null;
  status: "active" | "merged";
  mergedIntoId: string | null;
};

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length >= left.length ? right : left;
}

export async function loadActiveProjectEntities(): Promise<ProjectEntityRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectEntities)
    .where(eq(projectEntities.status, "active"));
  return rows.map((row) => ({
    id: row.id,
    identityKey: row.identityKey,
    name: row.name,
    yearHint: row.yearHint,
    phase: row.phase,
    contractor: row.contractor,
    location: row.location,
    equipmentMentions: row.equipmentMentions,
    scope: parseProjectScope(row.scope),
    status: row.status as "active" | "merged",
    mergedIntoId: row.mergedIntoId,
  }));
}

export async function resolveProjectEntityId(
  projectIdOrKey: string,
): Promise<string | null> {
  const db = getDb();
  const byId = await db
    .select({
      id: projectEntities.id,
      status: projectEntities.status,
      mergedIntoId: projectEntities.mergedIntoId,
    })
    .from(projectEntities)
    .where(eq(projectEntities.id, projectIdOrKey))
    .limit(1);
  if (byId[0]) {
    if (byId[0].status === "merged" && byId[0].mergedIntoId) {
      return resolveProjectEntityId(byId[0].mergedIntoId);
    }
    return byId[0].id;
  }
  const mergeMap = await loadProjectMergeMap();
  const survivorKey = resolveProjectSurvivorKey(projectIdOrKey, mergeMap);
  const byKey = await db
    .select({
      id: projectEntities.id,
      status: projectEntities.status,
      mergedIntoId: projectEntities.mergedIntoId,
    })
    .from(projectEntities)
    .where(eq(projectEntities.identityKey, survivorKey))
    .limit(1);
  if (!byKey[0]) return null;
  if (byKey[0].status === "merged" && byKey[0].mergedIntoId) {
    return resolveProjectEntityId(byKey[0].mergedIntoId);
  }
  return byKey[0].id;
}

/**
 * Upsert project_entities from current fingerprint summaries.
 * Returns active entities keyed by identity_key (post manual-merge survivor).
 */
export async function syncProjectEntitiesFromFingerprints(params?: {
  limit?: number;
}): Promise<{
  projects: ProjectEntityRow[];
  created: number;
  updated: number;
}> {
  const { projects: summaries } = await loadProjectFingerprintSummaries({
    limit: params?.limit ?? 2000,
  });
  return upsertProjectEntitiesFromSummaries(summaries);
}

export async function upsertProjectEntitiesFromSummaries(
  summaries: ProjectFingerprintSummary[],
): Promise<{
  projects: ProjectEntityRow[];
  created: number;
  updated: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const keys = summaries.map((s) => s.id);
  const existing =
    keys.length === 0
      ? []
      : await db
          .select()
          .from(projectEntities)
          .where(inArray(projectEntities.identityKey, keys));
  const byKey = new Map(existing.map((row) => [row.identityKey, row]));

  let created = 0;
  let updated = 0;
  const out: ProjectEntityRow[] = [];

  for (const summary of summaries) {
    const prior = byKey.get(summary.id);
    if (!prior) {
      const id = randomUUID();
      await db.insert(projectEntities).values({
        id,
        identityKey: summary.id,
        name: summary.name,
        yearHint: summary.year_hint,
        phase: summary.phase,
        contractor: summary.contractor,
        location: summary.location,
        equipmentMentions: summary.equipment_mentions,
        scope: resolveProjectScope(summary),
        status: "active",
        mergedIntoId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      created += 1;
      out.push({
        id,
        identityKey: summary.id,
        name: summary.name,
        yearHint: summary.year_hint,
        phase: summary.phase,
        contractor: summary.contractor,
        location: summary.location,
        equipmentMentions: summary.equipment_mentions,
        scope: resolveProjectScope(summary),
        status: "active",
        mergedIntoId: null,
      });
      continue;
    }

    const next = {
      name: preferString(prior.name, summary.name),
      yearHint: preferString(prior.yearHint, summary.year_hint),
      phase: preferString(prior.phase, summary.phase),
      contractor: mergeProjectMultiValues(prior.contractor, summary.contractor),
      location: mergeProjectMultiValues(prior.location, summary.location),
      equipmentMentions: mergeProjectMultiValues(
        prior.equipmentMentions,
        summary.equipment_mentions,
      ),
      scope: preferProjectScope(
        parseProjectScope(prior.scope),
        resolveProjectScope(summary),
      ),
    };
    const changed =
      next.name !== prior.name ||
      next.yearHint !== prior.yearHint ||
      next.phase !== prior.phase ||
      next.contractor !== prior.contractor ||
      next.location !== prior.location ||
      next.equipmentMentions !== prior.equipmentMentions ||
      next.scope !== parseProjectScope(prior.scope) ||
      prior.status !== "active";

    if (changed) {
      await db
        .update(projectEntities)
        .set({
          ...next,
          status: "active",
          mergedIntoId: null,
          updatedAt: nowIso,
        })
        .where(eq(projectEntities.id, prior.id));
      updated += 1;
    }

    out.push({
      id: prior.id,
      identityKey: prior.identityKey,
      name: next.name,
      yearHint: next.yearHint,
      phase: next.phase,
      contractor: next.contractor,
      location: next.location,
      equipmentMentions: next.equipmentMentions,
      scope: next.scope,
      status: "active",
      mergedIntoId: null,
    });
  }

  return { projects: out, created, updated };
}

/**
 * After a manual project identity-key merge, mark absorbed entity rows as merged
 * and point them at the survivor entity.
 */
export async function markProjectEntitiesMerged(params: {
  absorbedKey: string;
  survivorKey: string;
}): Promise<{ survivorId: string | null; absorbedId: string | null }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = await db
    .select()
    .from(projectEntities)
    .where(
      inArray(projectEntities.identityKey, [
        params.absorbedKey,
        params.survivorKey,
      ]),
    );
  const absorbed = rows.find((r) => r.identityKey === params.absorbedKey);
  const survivor = rows.find((r) => r.identityKey === params.survivorKey);

  if (!survivor && absorbed) {
    await db
      .update(projectEntities)
      .set({
        identityKey: params.survivorKey,
        updatedAt: nowIso,
      })
      .where(eq(projectEntities.id, absorbed.id));
    return { survivorId: absorbed.id, absorbedId: null };
  }

  if (!survivor) {
    return { survivorId: null, absorbedId: absorbed?.id ?? null };
  }

  if (absorbed && absorbed.id !== survivor.id) {
    await db
      .update(projectEntities)
      .set({
        status: "merged",
        mergedIntoId: survivor.id,
        updatedAt: nowIso,
      })
      .where(eq(projectEntities.id, absorbed.id));
  }

  return {
    survivorId: survivor.id,
    absorbedId: absorbed?.id ?? null,
  };
}
