/** Matching-queue loader: people needing an org link + deterministic shortlist. */

import { inArray } from "drizzle-orm";

import {
  computePersonOrgMatchHits,
  primarySourceFromHit,
} from "@/lib/affiliations/matching";
import { loadAffiliationMatchContext } from "@/lib/affiliations/propose";
import {
  parseAffiliationEvidence,
  type AffiliationConfidence,
  type AffiliationEvidence,
  type AffiliationSource,
  type AffiliationStatus,
} from "@/lib/affiliations/shared";
import {
  parseNameAliasesJson,
  personDisplayName,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  organizationEntities,
  personOrganizationAffiliations,
} from "@/lib/db/schema";

export type AffiliationQueueCandidate = {
  organizationId: string;
  organizationKey: string;
  organizationName: string | null;
  organizationEmail: string | null;
  source: AffiliationSource;
  confidence: AffiliationConfidence;
  evidence: AffiliationEvidence;
  /** Existing affiliation row id when already proposed / decided. */
  affiliationId: string | null;
  status: AffiliationStatus | null;
};

export type AffiliationQueuePerson = {
  personId: string;
  displayName: string;
  nameAliases: string[];
  emails: string[];
  mentionWeight: number;
  currentOrganizationId: string | null;
  currentOrganizationName: string | null;
  candidateCount: number;
  candidates: AffiliationQueueCandidate[];
};

export type AffiliationMatchingQueue = {
  people: AffiliationQueuePerson[];
  stats: {
    peopleNeedingLink: number;
    peopleWithCandidates: number;
    totalCandidates: number;
    organizationCount: number;
  };
  orgSync: { created: number; updated: number; organizationCount: number };
};

const MAX_CANDIDATES_PER_PERSON = 8;

/**
 * People without an approved current org, with a short deterministic org list
 * on the right. Skips denied pairs; includes existing pending rows.
 */
export async function loadAffiliationMatchingQueue(params?: {
  limitPersons?: number;
}): Promise<AffiliationMatchingQueue> {
  const ctx = await loadAffiliationMatchContext({
    limitPersons: params?.limitPersons ?? 2000,
  });

  const orgNameById = new Map(
    ctx.orgs.map((o) => [o.id, { name: o.name, email: o.email }] as const),
  );

  const currentOrgIds = [
    ...new Set(
      ctx.persons
        .map((p) => p.currentOrganizationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const db = getDb();
  if (currentOrgIds.length > 0) {
    const extra = await db
      .select({
        id: organizationEntities.id,
        name: organizationEntities.name,
        email: organizationEntities.email,
      })
      .from(organizationEntities)
      .where(inArray(organizationEntities.id, currentOrgIds));
    for (const row of extra) {
      if (!orgNameById.has(row.id)) {
        orgNameById.set(row.id, { name: row.name, email: row.email });
      }
    }
  }

  // Prefetch affiliation row details for pending/approved/denied lookups.
  const affiliationDetails = new Map<
    string,
    {
      id: string;
      status: string;
      source: string;
      confidence: string;
      evidence: AffiliationEvidence;
    }
  >();
  const existingIds = [...ctx.existing.values()].map((e) => e.id);
  if (existingIds.length > 0) {
    // Chunk to keep IN lists reasonable.
    const chunkSize = 500;
    for (let i = 0; i < existingIds.length; i += chunkSize) {
      const chunk = existingIds.slice(i, i + chunkSize);
      const rows = await db
        .select({
          id: personOrganizationAffiliations.id,
          personId: personOrganizationAffiliations.personId,
          organizationId: personOrganizationAffiliations.organizationId,
          status: personOrganizationAffiliations.status,
          source: personOrganizationAffiliations.source,
          confidence: personOrganizationAffiliations.confidence,
          evidenceJson: personOrganizationAffiliations.evidenceJson,
        })
        .from(personOrganizationAffiliations)
        .where(inArray(personOrganizationAffiliations.id, chunk));
      for (const row of rows) {
        affiliationDetails.set(`${row.personId}::${row.organizationId}`, {
          id: row.id,
          status: row.status,
          source: row.source,
          confidence: row.confidence,
          evidence: parseAffiliationEvidence(row.evidenceJson),
        });
      }
    }
  }

  const people: AffiliationQueuePerson[] = [];
  let totalCandidates = 0;

  for (const person of ctx.persons) {
    // Queue = unlinked people. Pending review for already-linked people stays
    // on the person detail panel for now.
    if (person.currentOrganizationId) continue;

    const personEmails = ctx.emailsByPerson.get(person.id) ?? [];
    const nameAliases = parseNameAliasesJson(person.nameAliasesJson);
    const hits = computePersonOrgMatchHits({
      personEmails: personEmails.map((e) => e.email),
      nameSignals: nameAliases,
      companiesByEmailId: ctx.companiesByEmailId,
      evidenceEmailIds: ctx.evidenceEmailIdsByPerson.get(person.id) ?? new Set(),
      organizations: ctx.orgs,
    });

    const candidates: AffiliationQueueCandidate[] = [];
    for (const hit of hits) {
      const key = `${person.id}::${hit.organization.id}`;
      const prior = affiliationDetails.get(key);
      if (prior?.status === "denied" || prior?.status === "approved") continue;

      let evidence = hit.evidence;
      let source = primarySourceFromHit(hit);
      let confidence = hit.confidence;
      let affiliationId: string | null = prior?.id ?? null;
      let status: AffiliationStatus | null =
        (prior?.status as AffiliationStatus | undefined) ?? null;

      if (prior?.status === "pending") {
        affiliationId = prior.id;
        status = "pending";
        source = prior.source as AffiliationSource;
        confidence = prior.confidence as AffiliationConfidence;
        evidence = prior.evidence;
      }

      candidates.push({
        organizationId: hit.organization.id,
        organizationKey: hit.organization.identityKey,
        organizationName: hit.organization.name,
        organizationEmail: hit.organization.email,
        source,
        confidence,
        evidence,
        affiliationId,
        status,
      });
      if (candidates.length >= MAX_CANDIDATES_PER_PERSON) break;
    }

    people.push({
      personId: person.id,
      displayName: personDisplayName({
        firstName: person.firstName,
        lastName: person.lastName,
      }),
      nameAliases,
      emails: personEmails.map((e) => e.email),
      mentionWeight: person.mentionWeight,
      currentOrganizationId: null,
      currentOrganizationName: null,
      candidateCount: candidates.length,
      candidates,
    });
    totalCandidates += candidates.length;
  }

  people.sort(
    (a, b) =>
      Number(b.candidateCount > 0) - Number(a.candidateCount > 0) ||
      b.candidateCount - a.candidateCount ||
      b.mentionWeight - a.mentionWeight ||
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      }),
  );

  return {
    people,
    stats: {
      peopleNeedingLink: people.length,
      peopleWithCandidates: people.filter((p) => p.candidateCount > 0).length,
      totalCandidates,
      organizationCount: ctx.orgs.length,
    },
    orgSync: ctx.orgSync,
  };
}
