/** Load affiliation rows for Entities UI. */

import { desc, eq, inArray } from "drizzle-orm";

import {
  parseAffiliationEvidence,
  type AffiliationRow,
} from "@/lib/affiliations/shared";
import { getDb } from "@/lib/db";
import {
  contactPersons,
  organizationEntities,
  personOrganizationAffiliations,
} from "@/lib/db/schema";

export async function loadAffiliationsForPerson(
  personId: string,
): Promise<AffiliationRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: personOrganizationAffiliations.id,
      personId: personOrganizationAffiliations.personId,
      organizationId: personOrganizationAffiliations.organizationId,
      organizationKey: personOrganizationAffiliations.organizationKey,
      relationType: personOrganizationAffiliations.relationType,
      status: personOrganizationAffiliations.status,
      source: personOrganizationAffiliations.source,
      confidence: personOrganizationAffiliations.confidence,
      evidenceJson: personOrganizationAffiliations.evidenceJson,
      createdAt: personOrganizationAffiliations.createdAt,
      updatedAt: personOrganizationAffiliations.updatedAt,
      reviewedAt: personOrganizationAffiliations.reviewedAt,
      organizationName: organizationEntities.name,
      organizationEmail: organizationEntities.email,
    })
    .from(personOrganizationAffiliations)
    .leftJoin(
      organizationEntities,
      eq(personOrganizationAffiliations.organizationId, organizationEntities.id),
    )
    .where(eq(personOrganizationAffiliations.personId, personId))
    .orderBy(desc(personOrganizationAffiliations.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    personId: row.personId,
    organizationId: row.organizationId,
    organizationKey: row.organizationKey,
    organizationName: row.organizationName,
    organizationEmail: row.organizationEmail,
    relationType: row.relationType as AffiliationRow["relationType"],
    status: row.status as AffiliationRow["status"],
    source: row.source as AffiliationRow["source"],
    confidence: row.confidence as AffiliationRow["confidence"],
    evidence: parseAffiliationEvidence(row.evidenceJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
  }));
}

export async function loadAffiliationsForPersons(
  personIds: string[],
): Promise<Map<string, AffiliationRow[]>> {
  const map = new Map<string, AffiliationRow[]>();
  if (personIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      id: personOrganizationAffiliations.id,
      personId: personOrganizationAffiliations.personId,
      organizationId: personOrganizationAffiliations.organizationId,
      organizationKey: personOrganizationAffiliations.organizationKey,
      relationType: personOrganizationAffiliations.relationType,
      status: personOrganizationAffiliations.status,
      source: personOrganizationAffiliations.source,
      confidence: personOrganizationAffiliations.confidence,
      evidenceJson: personOrganizationAffiliations.evidenceJson,
      createdAt: personOrganizationAffiliations.createdAt,
      updatedAt: personOrganizationAffiliations.updatedAt,
      reviewedAt: personOrganizationAffiliations.reviewedAt,
      organizationName: organizationEntities.name,
      organizationEmail: organizationEntities.email,
    })
    .from(personOrganizationAffiliations)
    .leftJoin(
      organizationEntities,
      eq(personOrganizationAffiliations.organizationId, organizationEntities.id),
    )
    .where(inArray(personOrganizationAffiliations.personId, personIds));

  for (const row of rows) {
    const item: AffiliationRow = {
      id: row.id,
      personId: row.personId,
      organizationId: row.organizationId,
      organizationKey: row.organizationKey,
      organizationName: row.organizationName,
      organizationEmail: row.organizationEmail,
      relationType: row.relationType as AffiliationRow["relationType"],
      status: row.status as AffiliationRow["status"],
      source: row.source as AffiliationRow["source"],
      confidence: row.confidence as AffiliationRow["confidence"],
      evidence: parseAffiliationEvidence(row.evidenceJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reviewedAt: row.reviewedAt,
    };
    const list = map.get(row.personId) ?? [];
    list.push(item);
    map.set(row.personId, list);
  }
  return map;
}

export async function getAffiliationStats(): Promise<{
  pendingCount: number;
  approvedCount: number;
  deniedCount: number;
  organizationEntityCount: number;
}> {
  const db = getDb();
  const [affRows, orgRows] = await Promise.all([
    db
      .select({ status: personOrganizationAffiliations.status })
      .from(personOrganizationAffiliations),
    db
      .select({ id: organizationEntities.id })
      .from(organizationEntities)
      .where(eq(organizationEntities.status, "active")),
  ]);

  let pendingCount = 0;
  let approvedCount = 0;
  let deniedCount = 0;
  for (const row of affRows) {
    if (row.status === "pending") pendingCount += 1;
    else if (row.status === "approved") approvedCount += 1;
    else if (row.status === "denied") deniedCount += 1;
  }

  return {
    pendingCount,
    approvedCount,
    deniedCount,
    organizationEntityCount: orgRows.length,
  };
}

export async function loadCurrentOrganizationLabels(
  personIds: string[],
): Promise<Map<string, { organizationId: string; name: string | null }>> {
  const map = new Map<string, { organizationId: string; name: string | null }>();
  if (personIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({
      personId: contactPersons.id,
      organizationId: contactPersons.currentOrganizationId,
      name: organizationEntities.name,
    })
    .from(contactPersons)
    .leftJoin(
      organizationEntities,
      eq(contactPersons.currentOrganizationId, organizationEntities.id),
    )
    .where(inArray(contactPersons.id, personIds));

  for (const row of rows) {
    if (!row.organizationId) continue;
    map.set(row.personId, {
      organizationId: row.organizationId,
      name: row.name,
    });
  }
  return map;
}
