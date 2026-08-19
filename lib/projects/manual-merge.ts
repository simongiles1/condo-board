/** Persist manual project merges from the Entities page. */

import { randomUUID } from "crypto";

import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectManualMerges } from "@/lib/db/schema";
import { markProjectEntitiesMerged } from "@/lib/projects/registry-sync";

export async function loadProjectMergeMap(): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db
    .select({
      absorbedKey: projectManualMerges.absorbedKey,
      survivorKey: projectManualMerges.survivorKey,
    })
    .from(projectManualMerges);
  return new Map(rows.map((row) => [row.absorbedKey, row.survivorKey]));
}

export function resolveProjectSurvivorKey(
  key: string,
  mergeMap: Map<string, string>,
): string {
  let cur = key;
  const seen = new Set<string>();
  while (mergeMap.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = mergeMap.get(cur)!;
  }
  return cur;
}

function mergeWouldCycle(
  absorbedKey: string,
  survivorKey: string,
  mergeMap: Map<string, string>,
): boolean {
  const probe = new Map(mergeMap);
  probe.set(absorbedKey, survivorKey);
  let cur = survivorKey;
  const seen = new Set<string>();
  while (probe.has(cur) && !seen.has(cur)) {
    if (cur === absorbedKey) return true;
    seen.add(cur);
    cur = probe.get(cur)!;
  }
  return cur === absorbedKey;
}

export async function recordProjectManualMerge(params: {
  sourceKey: string;
  targetKey: string;
}): Promise<{ ok: true; survivorKey: string } | { ok: false; error: string }> {
  const sourceKey = params.sourceKey.trim();
  const targetKey = params.targetKey.trim();
  if (!sourceKey || !targetKey) {
    return {
      ok: false,
      error: "Both source and target project ids are required.",
    };
  }
  if (sourceKey === targetKey) {
    return { ok: false, error: "Cannot merge a project into itself." };
  }

  const mergeMap = await loadProjectMergeMap();
  const resolvedTarget = resolveProjectSurvivorKey(targetKey, mergeMap);
  const resolvedSource = resolveProjectSurvivorKey(sourceKey, mergeMap);
  if (resolvedSource === resolvedTarget) {
    return { ok: false, error: "These projects are already merged." };
  }
  if (mergeWouldCycle(resolvedSource, resolvedTarget, mergeMap)) {
    return { ok: false, error: "That merge would create a cycle." };
  }

  await persistProjectMergeEdges([
    { absorbedKey: resolvedSource, survivorKey: resolvedTarget },
  ]);

  await markProjectEntitiesMerged({
    absorbedKey: resolvedSource,
    survivorKey: resolvedTarget,
  });

  return { ok: true, survivorKey: resolvedTarget };
}

async function persistProjectMergeEdges(
  edges: Array<{ absorbedKey: string; survivorKey: string }>,
): Promise<void> {
  if (edges.length === 0) return;
  const db = getDb();
  const absorbedKeys = edges.map((e) => e.absorbedKey);
  const existing = await db
    .select({
      id: projectManualMerges.id,
      absorbedKey: projectManualMerges.absorbedKey,
    })
    .from(projectManualMerges)
    .where(inArray(projectManualMerges.absorbedKey, absorbedKeys));
  const existingByAbsorbed = new Map(
    existing.map((row) => [row.absorbedKey, row.id]),
  );
  const nowIso = new Date().toISOString();
  const toInsert: Array<{
    id: string;
    absorbedKey: string;
    survivorKey: string;
    createdAt: string;
  }> = [];

  for (const edge of edges) {
    const existingId = existingByAbsorbed.get(edge.absorbedKey);
    if (existingId) {
      await db
        .update(projectManualMerges)
        .set({ survivorKey: edge.survivorKey })
        .where(eq(projectManualMerges.id, existingId));
    } else {
      toInsert.push({
        id: randomUUID(),
        absorbedKey: edge.absorbedKey,
        survivorKey: edge.survivorKey,
        createdAt: nowIso,
      });
    }
  }

  if (toInsert.length > 0) {
    await db.insert(projectManualMerges).values(toInsert);
  }
}

/**
 * Manual UI merge: absorb each source into `targetProjectId` (target survives).
 */
export async function manualMergeManyProjects(params: {
  sourceProjectIds: string[];
  targetProjectId: string;
}): Promise<
  | { ok: true; survivorKey: string; merged: number }
  | { ok: false; error: string }
> {
  const targetKey = params.targetProjectId.trim();
  if (!targetKey) {
    return { ok: false, error: "Target project id is required." };
  }

  const sourceKeys = [
    ...new Set(
      params.sourceProjectIds
        .map((id) => id.trim())
        .filter((id) => id && id !== targetKey),
    ),
  ];
  if (sourceKeys.length === 0) {
    const hadOnlyTarget = params.sourceProjectIds.some(
      (id) => id.trim() === targetKey,
    );
    if (hadOnlyTarget && params.sourceProjectIds.length > 0) {
      return { ok: false, error: "Cannot merge a project into itself." };
    }
    return { ok: false, error: "At least one source project is required." };
  }

  const mergeMap = await loadProjectMergeMap();
  const survivorKey = resolveProjectSurvivorKey(targetKey, mergeMap);
  const edges: Array<{ absorbedKey: string; survivorKey: string }> = [];

  for (const sourceKey of sourceKeys) {
    const resolvedSource = resolveProjectSurvivorKey(sourceKey, mergeMap);
    if (resolvedSource === survivorKey) {
      return { ok: false, error: "These projects are already merged." };
    }
    if (mergeWouldCycle(resolvedSource, survivorKey, mergeMap)) {
      return { ok: false, error: "That merge would create a cycle." };
    }
    mergeMap.set(resolvedSource, survivorKey);
    edges.push({ absorbedKey: resolvedSource, survivorKey });
  }

  await persistProjectMergeEdges(edges);

  await Promise.all(
    edges.map(async (edge) => {
      await markProjectEntitiesMerged({
        absorbedKey: edge.absorbedKey,
        survivorKey: edge.survivorKey,
      });
    }),
  );

  return { ok: true, survivorKey, merged: edges.length };
}
