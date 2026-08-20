/** Sync fingerprint org summaries into durable organization_entities rows. */

import { randomUUID } from "crypto";

import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationEntities } from "@/lib/db/schema";
import {
  loadOrgFingerprintSummaries,
  type OrgFingerprintSummary,
} from "@/lib/organizations/fingerprint-list";
import {
  loadOrganizationMergeMap,
  resolveOrgSurvivorKey,
} from "@/lib/organizations/manual-merge";
import { mergeOrgMultiValues } from "@/lib/organizations/org-multi-values";

export type OrganizationEntityRow = {
  id: string;
  identityKey: string;
  name: string | null;
  organizationRole: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
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

export async function loadActiveOrganizationEntities(): Promise<
  OrganizationEntityRow[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(organizationEntities)
    .where(eq(organizationEntities.status, "active"));
  return rows.map((row) => ({
    id: row.id,
    identityKey: row.identityKey,
    name: row.name,
    organizationRole: row.organizationRole,
    email: row.email,
    phone: row.phone,
    website: row.website,
    status: row.status as "active" | "merged",
    mergedIntoId: row.mergedIntoId,
  }));
}

export async function resolveOrganizationEntityId(
  organizationIdOrKey: string,
): Promise<string | null> {
  const db = getDb();
  const byId = await db
    .select({
      id: organizationEntities.id,
      status: organizationEntities.status,
      mergedIntoId: organizationEntities.mergedIntoId,
    })
    .from(organizationEntities)
    .where(eq(organizationEntities.id, organizationIdOrKey))
    .limit(1);
  if (byId[0]) {
    if (byId[0].status === "merged" && byId[0].mergedIntoId) {
      return resolveOrganizationEntityId(byId[0].mergedIntoId);
    }
    return byId[0].id;
  }
  const mergeMap = await loadOrganizationMergeMap();
  const survivorKey = resolveOrgSurvivorKey(organizationIdOrKey, mergeMap);
  const byKey = await db
    .select({
      id: organizationEntities.id,
      status: organizationEntities.status,
      mergedIntoId: organizationEntities.mergedIntoId,
    })
    .from(organizationEntities)
    .where(eq(organizationEntities.identityKey, survivorKey))
    .limit(1);
  if (!byKey[0]) return null;
  if (byKey[0].status === "merged" && byKey[0].mergedIntoId) {
    return resolveOrganizationEntityId(byKey[0].mergedIntoId);
  }
  return byKey[0].id;
}

/**
 * Upsert organization_entities from current fingerprint summaries.
 * Returns active entities keyed by identity_key (post manual-merge survivor).
 */
export async function syncOrganizationEntitiesFromFingerprints(params?: {
  limit?: number;
}): Promise<{
  organizations: OrganizationEntityRow[];
  created: number;
  updated: number;
}> {
  const { organizations: summaries } = await loadOrgFingerprintSummaries({
    limit: params?.limit,
  });
  return upsertOrganizationEntitiesFromSummaries(summaries);
}

export async function upsertOrganizationEntitiesFromSummaries(
  summaries: OrgFingerprintSummary[],
): Promise<{
  organizations: OrganizationEntityRow[];
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
          .from(organizationEntities)
          .where(inArray(organizationEntities.identityKey, keys));
  const byKey = new Map(existing.map((row) => [row.identityKey, row]));

  let created = 0;
  let updated = 0;
  const out: OrganizationEntityRow[] = [];

  for (const summary of summaries) {
    const prior = byKey.get(summary.id);
    if (!prior) {
      const id = randomUUID();
      await db.insert(organizationEntities).values({
        id,
        identityKey: summary.id,
        name: summary.name,
        organizationRole: summary.organization_role,
        email: summary.email,
        phone: summary.phone,
        website: summary.website,
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
        organizationRole: summary.organization_role,
        email: summary.email,
        phone: summary.phone,
        website: summary.website,
        status: "active",
        mergedIntoId: null,
      });
      continue;
    }

    const next = {
      name: preferString(prior.name, summary.name),
      organizationRole: preferString(
        prior.organizationRole,
        summary.organization_role,
      ),
      email: mergeOrgMultiValues("email", prior.email, summary.email),
      phone: mergeOrgMultiValues("phone", prior.phone, summary.phone),
      website: mergeOrgMultiValues("website", prior.website, summary.website),
    };
    const changed =
      next.name !== prior.name ||
      next.organizationRole !== prior.organizationRole ||
      next.email !== prior.email ||
      next.phone !== prior.phone ||
      next.website !== prior.website ||
      prior.status !== "active";

    if (changed) {
      await db
        .update(organizationEntities)
        .set({
          ...next,
          status: "active",
          mergedIntoId: null,
          updatedAt: nowIso,
        })
        .where(eq(organizationEntities.id, prior.id));
      updated += 1;
    }

    out.push({
      id: prior.id,
      identityKey: prior.identityKey,
      name: next.name,
      organizationRole: next.organizationRole,
      email: next.email,
      phone: next.phone,
      website: next.website,
      status: "active",
      mergedIntoId: null,
    });
  }

  return { organizations: out, created, updated };
}

/**
 * After a manual org identity-key merge, mark absorbed entity rows as merged
 * and point them at the survivor entity.
 */
export async function markOrganizationEntitiesMerged(params: {
  absorbedKey: string;
  survivorKey: string;
}): Promise<{ survivorId: string | null; absorbedId: string | null }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = await db
    .select()
    .from(organizationEntities)
    .where(
      inArray(organizationEntities.identityKey, [
        params.absorbedKey,
        params.survivorKey,
      ]),
    );
  const absorbed = rows.find((r) => r.identityKey === params.absorbedKey);
  let survivor = rows.find((r) => r.identityKey === params.survivorKey);

  if (!survivor && absorbed) {
    // Survivor key may not be materialized yet — promote absorbed identity.
    await db
      .update(organizationEntities)
      .set({
        identityKey: params.survivorKey,
        updatedAt: nowIso,
      })
      .where(eq(organizationEntities.id, absorbed.id));
    return { survivorId: absorbed.id, absorbedId: null };
  }

  if (!survivor) {
    return { survivorId: null, absorbedId: absorbed?.id ?? null };
  }

  if (absorbed && absorbed.id !== survivor.id) {
    await db
      .update(organizationEntities)
      .set({
        status: "merged",
        mergedIntoId: survivor.id,
        updatedAt: nowIso,
      })
      .where(eq(organizationEntities.id, absorbed.id));
  }

  return {
    survivorId: survivor.id,
    absorbedId: absorbed?.id ?? null,
  };
}
