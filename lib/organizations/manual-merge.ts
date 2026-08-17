/** Persist manual organization merges from the Entities page. */

import { randomUUID } from "crypto";

import { eq, inArray } from "drizzle-orm";

import { rewriteAffiliationsForOrgMerge } from "@/lib/affiliations/apply";
import { getDb } from "@/lib/db";
import { organizationManualMerges } from "@/lib/db/schema";
import { markOrganizationEntitiesMerged } from "@/lib/organizations/registry-sync";

export async function loadOrganizationMergeMap(): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db
    .select({
      absorbedKey: organizationManualMerges.absorbedKey,
      survivorKey: organizationManualMerges.survivorKey,
    })
    .from(organizationManualMerges);
  return new Map(rows.map((row) => [row.absorbedKey, row.survivorKey]));
}

export function resolveOrgSurvivorKey(
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

export async function recordOrganizationManualMerge(params: {
  sourceKey: string;
  targetKey: string;
}): Promise<{ ok: true; survivorKey: string } | { ok: false; error: string }> {
  const sourceKey = params.sourceKey.trim();
  const targetKey = params.targetKey.trim();
  if (!sourceKey || !targetKey) {
    return {
      ok: false,
      error: "Both source and target organization ids are required.",
    };
  }
  if (sourceKey === targetKey) {
    return { ok: false, error: "Cannot merge an organization into itself." };
  }

  const mergeMap = await loadOrganizationMergeMap();
  const resolvedTarget = resolveOrgSurvivorKey(targetKey, mergeMap);
  const resolvedSource = resolveOrgSurvivorKey(sourceKey, mergeMap);
  if (resolvedSource === resolvedTarget) {
    return { ok: false, error: "These organizations are already merged." };
  }
  if (mergeWouldCycle(resolvedSource, resolvedTarget, mergeMap)) {
    return { ok: false, error: "That merge would create a cycle." };
  }

  await persistOrgMergeEdges([
    { absorbedKey: resolvedSource, survivorKey: resolvedTarget },
  ]);

  // Keep thin org registry + affiliation edges aligned with identity-key merges.
  const entityMerge = await markOrganizationEntitiesMerged({
    absorbedKey: resolvedSource,
    survivorKey: resolvedTarget,
  });
  if (entityMerge.absorbedId && entityMerge.survivorId) {
    await rewriteAffiliationsForOrgMerge({
      absorbedOrganizationId: entityMerge.absorbedId,
      survivorOrganizationId: entityMerge.survivorId,
      survivorIdentityKey: resolvedTarget,
    });
  }

  return { ok: true, survivorKey: resolvedTarget };
}

async function persistOrgMergeEdges(
  edges: Array<{ absorbedKey: string; survivorKey: string }>,
): Promise<void> {
  if (edges.length === 0) return;
  const db = getDb();
  const absorbedKeys = edges.map((e) => e.absorbedKey);
  const existing = await db
    .select({
      id: organizationManualMerges.id,
      absorbedKey: organizationManualMerges.absorbedKey,
    })
    .from(organizationManualMerges)
    .where(inArray(organizationManualMerges.absorbedKey, absorbedKeys));
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
        .update(organizationManualMerges)
        .set({ survivorKey: edge.survivorKey })
        .where(eq(organizationManualMerges.id, existingId));
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
    await db.insert(organizationManualMerges).values(toInsert);
  }
}

/**
 * Manual UI merge: absorb each source into `targetOrganizationId` (target survives).
 * Loads the merge map once and persists all edges before rewriting affiliations.
 */
export async function manualMergeManyOrganizations(params: {
  sourceOrganizationIds: string[];
  targetOrganizationId: string;
}): Promise<
  | { ok: true; survivorKey: string; merged: number }
  | { ok: false; error: string }
> {
  const targetKey = params.targetOrganizationId.trim();
  if (!targetKey) {
    return { ok: false, error: "Target organization id is required." };
  }

  const sourceKeys = [
    ...new Set(
      params.sourceOrganizationIds
        .map((id) => id.trim())
        .filter((id) => id && id !== targetKey),
    ),
  ];
  if (sourceKeys.length === 0) {
    const hadOnlyTarget = params.sourceOrganizationIds.some(
      (id) => id.trim() === targetKey,
    );
    if (hadOnlyTarget && params.sourceOrganizationIds.length > 0) {
      return { ok: false, error: "Cannot merge an organization into itself." };
    }
    return { ok: false, error: "At least one source organization is required." };
  }

  const mergeMap = await loadOrganizationMergeMap();
  const survivorKey = resolveOrgSurvivorKey(targetKey, mergeMap);
  const edges: Array<{ absorbedKey: string; survivorKey: string }> = [];

  for (const sourceKey of sourceKeys) {
    const resolvedSource = resolveOrgSurvivorKey(sourceKey, mergeMap);
    if (resolvedSource === survivorKey) {
      return { ok: false, error: "These organizations are already merged." };
    }
    if (mergeWouldCycle(resolvedSource, survivorKey, mergeMap)) {
      return { ok: false, error: "That merge would create a cycle." };
    }
    // Apply locally so later sources in this batch resolve through new edges.
    mergeMap.set(resolvedSource, survivorKey);
    edges.push({ absorbedKey: resolvedSource, survivorKey });
  }

  await persistOrgMergeEdges(edges);

  // Entity marks + affiliation rewrites can run per absorbed key; parallelize.
  await Promise.all(
    edges.map(async (edge) => {
      const entityMerge = await markOrganizationEntitiesMerged({
        absorbedKey: edge.absorbedKey,
        survivorKey: edge.survivorKey,
      });
      if (entityMerge.absorbedId && entityMerge.survivorId) {
        await rewriteAffiliationsForOrgMerge({
          absorbedOrganizationId: entityMerge.absorbedId,
          survivorOrganizationId: entityMerge.survivorId,
          survivorIdentityKey: edge.survivorKey,
        });
      }
    }),
  );

  return { ok: true, survivorKey, merged: edges.length };
}
