/** Deterministic person↔org affiliation proposal generators. */

import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  parseAffiliationEvidence,
  serializeAffiliationEvidence,
  type AffiliationConfidence,
  type AffiliationSource,
} from "@/lib/affiliations/shared";
import {
  computePersonOrgMatchHits,
  primarySourceFromHit,
  type OrgMatchTarget,
} from "@/lib/affiliations/matching";
import { parseNameAliasesJson } from "@/lib/contacts/person-name";
import { getDb } from "@/lib/db";
import {
  contactHighlightExtractions,
  contactPersonEmails,
  contactPersons,
  personOrganizationAffiliations,
} from "@/lib/db/schema";
import {
  parseContactHighlightExtraction,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";
import { loadOrgFingerprintSummaries } from "@/lib/organizations/fingerprint-list";
import {
  syncOrganizationEntitiesFromFingerprints,
  type OrganizationEntityRow,
} from "@/lib/organizations/registry-sync";

function mergeHighlightExtractions(
  parts: ContactHighlightExtraction[],
): ContactHighlightExtraction {
  const company_names = [
    ...new Set(parts.flatMap((p) => p.company_names.map((c) => c.trim()).filter(Boolean))),
  ];
  return {
    contact_names: [],
    phones: [],
    job_titles: [],
    company_names,
  };
}

async function loadOrgMatchTargets(
  orgs: OrganizationEntityRow[],
): Promise<OrgMatchTarget[]> {
  // Aliases live on fingerprints, not the thin registry — attach for name match.
  const { organizations: fingerprints } = await loadOrgFingerprintSummaries({
    limit: 2000,
  });
  const aliasesByKey = new Map<string, string[]>();
  for (const fp of fingerprints) {
    aliasesByKey.set(fp.id, fp.aliases ?? []);
  }
  return orgs.map((org) => ({
    ...org,
    aliases: aliasesByKey.get(org.identityKey) ?? [],
  }));
}

export async function loadExistingAffiliationKeys(): Promise<
  Map<string, { status: string; id: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: personOrganizationAffiliations.id,
      personId: personOrganizationAffiliations.personId,
      organizationId: personOrganizationAffiliations.organizationId,
      status: personOrganizationAffiliations.status,
    })
    .from(personOrganizationAffiliations);
  const map = new Map<string, { status: string; id: string }>();
  for (const row of rows) {
    map.set(`${row.personId}::${row.organizationId}`, {
      status: row.status,
      id: row.id,
    });
  }
  return map;
}

async function insertPendingIfNew(params: {
  personId: string;
  organization: OrganizationEntityRow;
  source: AffiliationSource;
  confidence: AffiliationConfidence;
  evidence: Record<string, unknown>;
  existing: Map<string, { status: string; id: string }>;
}): Promise<"created" | "skipped"> {
  const key = `${params.personId}::${params.organization.id}`;
  const prior = params.existing.get(key);
  // Denied = negative evidence; approved/pending already exist — do not re-propose.
  if (prior) return "skipped";

  const db = getDb();
  const nowIso = new Date().toISOString();
  const id = randomUUID();
  await db.insert(personOrganizationAffiliations).values({
    id,
    personId: params.personId,
    organizationId: params.organization.id,
    organizationKey: params.organization.identityKey,
    relationType: "employed_at",
    status: "pending",
    source: params.source,
    confidence: params.confidence,
    evidenceJson: serializeAffiliationEvidence(params.evidence),
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedAt: null,
  });
  params.existing.set(key, { status: "pending", id });
  return "created";
}

/**
 * Shared evidence + org targets used by propose and the matching queue.
 */
export async function loadAffiliationMatchContext(params?: {
  limitPersons?: number;
  personIds?: string[];
}): Promise<{
  orgs: OrgMatchTarget[];
  orgSync: { created: number; updated: number; organizationCount: number };
  persons: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    nameAliasesJson: string | null;
    currentOrganizationId: string | null;
    mentionWeight: number;
  }>;
  emailsByPerson: Map<
    string,
    Array<{ id: string; email: string; evidenceJson: string }>
  >;
  evidenceEmailIdsByPerson: Map<string, Set<string>>;
  companiesByEmailId: Map<string, string[]>;
  existing: Map<string, { status: string; id: string }>;
}> {
  const orgSync = await syncOrganizationEntitiesFromFingerprints({
    limit: 2000,
  });
  const orgs = await loadOrgMatchTargets(orgSync.organizations);
  const existing = await loadExistingAffiliationKeys();
  const db = getDb();
  const limitPersons = params?.limitPersons ?? 2000;

  let persons: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    nameAliasesJson: string | null;
    currentOrganizationId: string | null;
    mentionWeight: number;
  }>;

  if (params?.personIds && params.personIds.length > 0) {
    persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        nameAliasesJson: contactPersons.nameAliasesJson,
        currentOrganizationId: contactPersons.currentOrganizationId,
        mentionWeight: contactPersons.mentionWeight,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, params.personIds));
  } else {
    persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        nameAliasesJson: contactPersons.nameAliasesJson,
        currentOrganizationId: contactPersons.currentOrganizationId,
        mentionWeight: contactPersons.mentionWeight,
      })
      .from(contactPersons)
      .limit(limitPersons);
  }

  const personIds = persons.map((p) => p.id);
  const emailAttrs =
    personIds.length === 0
      ? []
      : await db
          .select({
            id: contactPersonEmails.id,
            personId: contactPersonEmails.personId,
            email: contactPersonEmails.email,
            evidenceJson: contactPersonEmails.evidenceJson,
          })
          .from(contactPersonEmails)
          .where(inArray(contactPersonEmails.personId, personIds));

  const emailsByPerson = new Map<
    string,
    Array<{ id: string; email: string; evidenceJson: string }>
  >();
  for (const row of emailAttrs) {
    const list = emailsByPerson.get(row.personId) ?? [];
    list.push({
      id: row.id,
      email: row.email,
      evidenceJson: row.evidenceJson,
    });
    emailsByPerson.set(row.personId, list);
  }

  const evidenceEmailIdsByPerson = new Map<string, Set<string>>();
  for (const row of emailAttrs) {
    let evidence: Array<{ emailId?: string }> = [];
    try {
      const parsed = JSON.parse(row.evidenceJson) as unknown;
      if (Array.isArray(parsed)) evidence = parsed as Array<{ emailId?: string }>;
    } catch {
      evidence = [];
    }
    const set = evidenceEmailIdsByPerson.get(row.personId) ?? new Set<string>();
    for (const item of evidence) {
      if (item.emailId?.trim()) set.add(item.emailId.trim());
    }
    evidenceEmailIdsByPerson.set(row.personId, set);
  }

  const allEvidenceEmailIds = [
    ...new Set([...evidenceEmailIdsByPerson.values()].flatMap((s) => [...s])),
  ];

  const highlightRows =
    allEvidenceEmailIds.length === 0
      ? []
      : await db
          .select({
            emailId: contactHighlightExtractions.emailId,
            extractionJson: contactHighlightExtractions.extractionJson,
            secondPassExtractionJson:
              contactHighlightExtractions.secondPassExtractionJson,
          })
          .from(contactHighlightExtractions)
          .where(inArray(contactHighlightExtractions.emailId, allEvidenceEmailIds));

  const companiesByEmailId = new Map<string, string[]>();
  for (const row of highlightRows) {
    const parts: ContactHighlightExtraction[] = [];
    try {
      parts.push(
        parseContactHighlightExtraction(JSON.parse(row.extractionJson) as unknown),
      );
    } catch {
      /* ignore */
    }
    if (row.secondPassExtractionJson) {
      try {
        parts.push(
          parseContactHighlightExtraction(
            JSON.parse(row.secondPassExtractionJson) as unknown,
          ),
        );
      } catch {
        /* ignore */
      }
    }
    const merged = mergeHighlightExtractions(parts);
    if (merged.company_names.length > 0) {
      companiesByEmailId.set(row.emailId, merged.company_names);
    }
  }

  return {
    orgs,
    orgSync: {
      created: orgSync.created,
      updated: orgSync.updated,
      organizationCount: orgs.length,
    },
    persons,
    emailsByPerson,
    evidenceEmailIdsByPerson,
    companiesByEmailId,
    existing,
  };
}

/**
 * Run deterministic proposers (exact corporate email-domain prior + company_name
 * / alias co-occurrence for people without a domain hit). Never auto-approves.
 * Syncs org entities first so keys are durable.
 */
export async function proposePersonOrganizationAffiliations(params?: {
  limitPersons?: number;
  personIds?: string[];
}): Promise<{
  orgSync: { created: number; updated: number; organizationCount: number };
  domainProposed: number;
  cooccurrenceProposed: number;
  ambiguousPersonIds: string[];
}> {
  if (params?.personIds && params.personIds.length === 0) {
    return {
      orgSync: { created: 0, updated: 0, organizationCount: 0 },
      domainProposed: 0,
      cooccurrenceProposed: 0,
      ambiguousPersonIds: [],
    };
  }

  const ctx = await loadAffiliationMatchContext({
    limitPersons: params?.limitPersons ?? 2000,
    personIds: params?.personIds,
  });
  const { orgs, existing, persons, emailsByPerson, evidenceEmailIdsByPerson, companiesByEmailId } =
    ctx;

  let domainProposed = 0;
  let cooccurrenceProposed = 0;
  const candidateCounts = new Map<string, Set<string>>();

  for (const person of persons) {
    const personEmails = emailsByPerson.get(person.id) ?? [];
    const hits = computePersonOrgMatchHits({
      personEmails: personEmails.map((e) => e.email),
      nameSignals: parseNameAliasesJson(person.nameAliasesJson),
      companiesByEmailId,
      evidenceEmailIds: evidenceEmailIdsByPerson.get(person.id) ?? new Set(),
      organizations: orgs,
    });

    candidateCounts.set(
      person.id,
      new Set(hits.map((h) => h.organization.id)),
    );

    for (const hit of hits) {
      const source = primarySourceFromHit(hit);
      const result = await insertPendingIfNew({
        personId: person.id,
        organization: hit.organization,
        source,
        confidence: hit.confidence,
        evidence: hit.evidence,
        existing,
      });
      if (result === "created") {
        if (source === "domain_prior") domainProposed += 1;
        else cooccurrenceProposed += 1;
      }
    }
  }

  // Ambiguous = multiple pending candidates for the same person (AI adjudicate later).
  const ambiguousPersonIds: string[] = [];
  for (const [personId, orgIds] of candidateCounts) {
    if (orgIds.size > 1) ambiguousPersonIds.push(personId);
  }

  // Also treat single cooccurrence-only (no domain) as ambiguous for AI assist.
  const db = getDb();
  const pendingRows = await db
    .select({
      personId: personOrganizationAffiliations.personId,
      source: personOrganizationAffiliations.source,
      organizationId: personOrganizationAffiliations.organizationId,
    })
    .from(personOrganizationAffiliations)
    .where(eq(personOrganizationAffiliations.status, "pending"));

  const pendingByPerson = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const list = pendingByPerson.get(row.personId) ?? [];
    list.push(row);
    pendingByPerson.set(row.personId, list);
  }
  for (const [personId, rows] of pendingByPerson) {
    if (params?.personIds && !params.personIds.includes(personId)) continue;
    if (rows.length > 1) {
      if (!ambiguousPersonIds.includes(personId)) ambiguousPersonIds.push(personId);
      continue;
    }
    if (
      rows.length === 1 &&
      rows[0]!.source === "cooccurrence" &&
      !ambiguousPersonIds.includes(personId)
    ) {
      ambiguousPersonIds.push(personId);
    }
  }

  return {
    orgSync: ctx.orgSync,
    domainProposed,
    cooccurrenceProposed,
    ambiguousPersonIds,
  };
}

/** Load pending affiliations for a person (for AI / UI). */
export async function loadPendingAffiliationsForPerson(personId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      and(
        eq(personOrganizationAffiliations.personId, personId),
        eq(personOrganizationAffiliations.status, "pending"),
      ),
    );
  return rows.map((row) => ({
    ...row,
    evidence: parseAffiliationEvidence(row.evidenceJson),
  }));
}
