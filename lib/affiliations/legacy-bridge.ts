/** Bridge Insights linked_organization_name into affiliation proposals. */

import { randomUUID } from "crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { serializeAffiliationEvidence } from "@/lib/affiliations/shared";
import { getDb } from "@/lib/db";
import {
  contactPersonEmails,
  contactPersons,
  entityMentions,
  personOrganizationAffiliations,
} from "@/lib/db/schema";
import { normalizeOrgNameKey } from "@/lib/organizations/field-denials";
import {
  syncOrganizationEntitiesFromFingerprints,
  type OrganizationEntityRow,
} from "@/lib/organizations/registry-sync";
import { normalizeContactRegistryEmail } from "@/lib/contacts/registry-shared";

function orgMatchesLinkedName(
  linkedName: string,
  org: OrganizationEntityRow,
): boolean {
  const linkedKey = normalizeOrgNameKey(linkedName);
  if (!linkedKey) return false;
  const orgKey = normalizeOrgNameKey(org.name);
  if (!orgKey) return false;
  return (
    orgKey === linkedKey ||
    orgKey.includes(linkedKey) ||
    linkedKey.includes(orgKey)
  );
}

/**
 * Resolve high-confidence Insights person↔org string links into pending
 * affiliation proposals. Only creates proposals when exactly one org matches.
 */
export async function bridgeLegacyLinkedOrganizationNames(params?: {
  limit?: number;
}): Promise<{
  scanned: number;
  proposed: number;
  skippedAmbiguous: number;
  skippedNoPerson: number;
  skippedNoOrg: number;
  skippedExisting: number;
}> {
  const orgSync = await syncOrganizationEntitiesFromFingerprints({
    limit: 2000,
  });
  const orgs = orgSync.organizations;
  const db = getDb();
  const limit = params?.limit ?? 2000;

  const mentions = await db
    .select({
      id: entityMentions.id,
      entityValue: entityMentions.entityValue,
      contactEmail: entityMentions.contactEmail,
      linkedOrganizationName: entityMentions.linkedOrganizationName,
      reviewStatus: entityMentions.reviewStatus,
    })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.entityType, "person"),
        isNotNull(entityMentions.linkedOrganizationName),
      ),
    )
    .limit(limit);

  const emailAttrs = await db.select().from(contactPersonEmails);
  const emailToPersonIds = new Map<string, Set<string>>();
  for (const row of emailAttrs) {
    const email = normalizeContactRegistryEmail(row.email);
    const set = emailToPersonIds.get(email) ?? new Set();
    set.add(row.personId);
    emailToPersonIds.set(email, set);
  }

  const persons = await db.select().from(contactPersons);
  const nameToPersonIds = new Map<string, Set<string>>();
  for (const person of persons) {
    const first = person.firstName?.trim().toLowerCase() ?? "";
    const last = person.lastName?.trim().toLowerCase() ?? "";
    if (first && last) {
      const key = `${first} ${last}`;
      const set = nameToPersonIds.get(key) ?? new Set();
      set.add(person.id);
      nameToPersonIds.set(key, set);
    }
  }

  const existing = await db
    .select({
      personId: personOrganizationAffiliations.personId,
      organizationId: personOrganizationAffiliations.organizationId,
    })
    .from(personOrganizationAffiliations);
  const existingKeys = new Set(
    existing.map((r) => `${r.personId}::${r.organizationId}`),
  );

  let scanned = 0;
  let proposed = 0;
  let skippedAmbiguous = 0;
  let skippedNoPerson = 0;
  let skippedNoOrg = 0;
  let skippedExisting = 0;

  const nowIso = new Date().toISOString();

  for (const mention of mentions) {
    const linked = mention.linkedOrganizationName?.trim();
    if (!linked) continue;
    scanned += 1;

    let personId: string | null = null;
    if (mention.contactEmail?.trim()) {
      const ids = emailToPersonIds.get(
        normalizeContactRegistryEmail(mention.contactEmail),
      );
      if (ids && ids.size === 1) personId = [...ids][0]!;
      else if (ids && ids.size > 1) {
        skippedAmbiguous += 1;
        continue;
      }
    }
    if (!personId) {
      const nameKey = mention.entityValue.trim().toLowerCase().replace(/\s+/g, " ");
      const ids = nameToPersonIds.get(nameKey);
      if (ids && ids.size === 1) personId = [...ids][0]!;
      else if (ids && ids.size > 1) {
        skippedAmbiguous += 1;
        continue;
      }
    }
    if (!personId) {
      skippedNoPerson += 1;
      continue;
    }

    const matches = orgs.filter((org) => orgMatchesLinkedName(linked, org));
    if (matches.length === 0) {
      skippedNoOrg += 1;
      continue;
    }
    if (matches.length > 1) {
      skippedAmbiguous += 1;
      continue;
    }

    const org = matches[0]!;
    const key = `${personId}::${org.id}`;
    if (existingKeys.has(key)) {
      skippedExisting += 1;
      continue;
    }

    await db.insert(personOrganizationAffiliations).values({
      id: randomUUID(),
      personId,
      organizationId: org.id,
      organizationKey: org.identityKey,
      relationType: "employed_at",
      status: "pending",
      source: "legacy_bridge",
      confidence: "medium",
      evidenceJson: serializeAffiliationEvidence({
        linkedOrganizationName: linked,
        rationale: "Bridged from Insights entity_mentions.linked_organization_name",
      }),
      createdAt: nowIso,
      updatedAt: nowIso,
      reviewedAt: null,
    });
    existingKeys.add(key);
    proposed += 1;
  }

  return {
    scanned,
    proposed,
    skippedAmbiguous,
    skippedNoPerson,
    skippedNoOrg,
    skippedExisting,
  };
}
