/** Approve / deny / manual create for person↔organization affiliations. */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import {
  serializeAffiliationEvidence,
  type AffiliationConfidence,
  type AffiliationEvidence,
  type AffiliationRelationType,
  type AffiliationSource,
} from "@/lib/affiliations/shared";
import { getDb } from "@/lib/db";
import {
  contactPersons,
  organizationEntities,
  personOrganizationAffiliations,
} from "@/lib/db/schema";
import { resolveOrganizationEntityId } from "@/lib/organizations/registry-sync";

async function setCurrentOrganizationPointer(params: {
  personId: string;
  organizationId: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .update(contactPersons)
    .set({
      currentOrganizationId: params.organizationId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(contactPersons.id, params.personId));
}

export async function approveAffiliation(params: {
  affiliationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(eq(personOrganizationAffiliations.id, params.affiliationId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Affiliation not found." };
  if (row.status === "denied") {
    return { ok: false, error: "Denied affiliations cannot be approved; create a new manual link." };
  }
  if (row.status === "approved") return { ok: true };

  const nowIso = new Date().toISOString();
  await db
    .update(personOrganizationAffiliations)
    .set({
      status: "approved",
      updatedAt: nowIso,
      reviewedAt: nowIso,
    })
    .where(eq(personOrganizationAffiliations.id, row.id));

  await setCurrentOrganizationPointer({
    personId: row.personId,
    organizationId: row.organizationId,
  });

  return { ok: true };
}

export async function denyAffiliation(params: {
  affiliationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(eq(personOrganizationAffiliations.id, params.affiliationId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Affiliation not found." };
  if (row.status === "denied") return { ok: true };

  const nowIso = new Date().toISOString();
  await db
    .update(personOrganizationAffiliations)
    .set({
      status: "denied",
      updatedAt: nowIso,
      reviewedAt: nowIso,
    })
    .where(eq(personOrganizationAffiliations.id, row.id));

  // Clear pointer if this was the current approved org.
  const personRows = await db
    .select({ currentOrganizationId: contactPersons.currentOrganizationId })
    .from(contactPersons)
    .where(eq(contactPersons.id, row.personId))
    .limit(1);
  if (personRows[0]?.currentOrganizationId === row.organizationId) {
    // Prefer another approved affiliation if any.
    const other = await db
      .select({ organizationId: personOrganizationAffiliations.organizationId })
      .from(personOrganizationAffiliations)
      .where(
        and(
          eq(personOrganizationAffiliations.personId, row.personId),
          eq(personOrganizationAffiliations.status, "approved"),
        ),
      )
      .limit(1);
    await setCurrentOrganizationPointer({
      personId: row.personId,
      organizationId: other[0]?.organizationId ?? null,
    });
  }

  return { ok: true };
}

export async function createManualAffiliation(params: {
  personId: string;
  organizationId: string;
  relationType?: AffiliationRelationType;
  evidence?: AffiliationEvidence;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const personId = params.personId.trim();
  const resolvedOrgId = await resolveOrganizationEntityId(
    params.organizationId.trim(),
  );
  if (!personId || !resolvedOrgId) {
    return { ok: false, error: "Person and organization are required." };
  }

  const db = getDb();
  const person = await db
    .select({ id: contactPersons.id })
    .from(contactPersons)
    .where(eq(contactPersons.id, personId))
    .limit(1);
  if (!person[0]) return { ok: false, error: "Person not found." };

  const org = await db
    .select()
    .from(organizationEntities)
    .where(eq(organizationEntities.id, resolvedOrgId))
    .limit(1);
  if (!org[0] || org[0].status === "merged") {
    return { ok: false, error: "Organization not found." };
  }

  const existing = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      and(
        eq(personOrganizationAffiliations.personId, personId),
        eq(personOrganizationAffiliations.organizationId, resolvedOrgId),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  const relationType = params.relationType ?? "employed_at";
  const evidenceJson = serializeAffiliationEvidence({
    ...(params.evidence ?? {}),
    rationale: params.evidence?.rationale ?? "Manual link from Entities UI",
  });

  if (existing[0]) {
    await db
      .update(personOrganizationAffiliations)
      .set({
        status: "approved",
        source: "manual",
        confidence: "high",
        relationType,
        evidenceJson,
        organizationKey: org[0].identityKey,
        updatedAt: nowIso,
        reviewedAt: nowIso,
      })
      .where(eq(personOrganizationAffiliations.id, existing[0].id));
    await setCurrentOrganizationPointer({
      personId,
      organizationId: resolvedOrgId,
    });
    return { ok: true, id: existing[0].id };
  }

  const id = randomUUID();
  await db.insert(personOrganizationAffiliations).values({
    id,
    personId,
    organizationId: resolvedOrgId,
    organizationKey: org[0].identityKey,
    relationType,
    status: "approved",
    source: "manual",
    confidence: "high",
    evidenceJson,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedAt: nowIso,
  });
  await setCurrentOrganizationPointer({
    personId,
    organizationId: resolvedOrgId,
  });
  return { ok: true, id };
}

/**
 * Matching-queue Accept: upsert person↔org then approve (works without a prior
 * Propose run when the shortlist was computed live).
 */
export async function acceptAffiliationCandidate(params: {
  personId: string;
  organizationId: string;
  affiliationId?: string | null;
  source?: AffiliationSource;
  confidence?: AffiliationConfidence;
  evidence?: AffiliationEvidence;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (params.affiliationId?.trim()) {
    const approved = await approveAffiliation({
      affiliationId: params.affiliationId.trim(),
    });
    if (!approved.ok) return approved;
    return { ok: true, id: params.affiliationId.trim() };
  }

  const personId = params.personId.trim();
  const resolvedOrgId = await resolveOrganizationEntityId(
    params.organizationId.trim(),
  );
  if (!personId || !resolvedOrgId) {
    return { ok: false, error: "Person and organization are required." };
  }

  const db = getDb();
  const org = await db
    .select()
    .from(organizationEntities)
    .where(eq(organizationEntities.id, resolvedOrgId))
    .limit(1);
  if (!org[0] || org[0].status === "merged") {
    return { ok: false, error: "Organization not found." };
  }

  const existing = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      and(
        eq(personOrganizationAffiliations.personId, personId),
        eq(personOrganizationAffiliations.organizationId, resolvedOrgId),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  const source = params.source ?? "domain_prior";
  const confidence = params.confidence ?? "medium";
  const evidenceJson = serializeAffiliationEvidence(params.evidence ?? {});

  if (existing[0]) {
    if (existing[0].status === "denied") {
      return {
        ok: false,
        error: "Denied affiliations cannot be approved; create a new manual link.",
      };
    }
    await db
      .update(personOrganizationAffiliations)
      .set({
        status: "approved",
        source: existing[0].source,
        confidence: existing[0].confidence,
        evidenceJson: existing[0].evidenceJson,
        updatedAt: nowIso,
        reviewedAt: nowIso,
      })
      .where(eq(personOrganizationAffiliations.id, existing[0].id));
    await setCurrentOrganizationPointer({
      personId,
      organizationId: resolvedOrgId,
    });
    return { ok: true, id: existing[0].id };
  }

  const id = randomUUID();
  await db.insert(personOrganizationAffiliations).values({
    id,
    personId,
    organizationId: resolvedOrgId,
    organizationKey: org[0].identityKey,
    relationType: "employed_at",
    status: "approved",
    source,
    confidence,
    evidenceJson,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedAt: nowIso,
  });
  await setCurrentOrganizationPointer({
    personId,
    organizationId: resolvedOrgId,
  });
  return { ok: true, id };
}

/**
 * Matching-queue Reject: upsert as denied so the pair is not re-shortlisted.
 */
export async function rejectAffiliationCandidate(params: {
  personId: string;
  organizationId: string;
  affiliationId?: string | null;
  source?: AffiliationSource;
  confidence?: AffiliationConfidence;
  evidence?: AffiliationEvidence;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (params.affiliationId?.trim()) {
    const denied = await denyAffiliation({
      affiliationId: params.affiliationId.trim(),
    });
    if (!denied.ok) return denied;
    return { ok: true, id: params.affiliationId.trim() };
  }

  const personId = params.personId.trim();
  const resolvedOrgId = await resolveOrganizationEntityId(
    params.organizationId.trim(),
  );
  if (!personId || !resolvedOrgId) {
    return { ok: false, error: "Person and organization are required." };
  }

  const db = getDb();
  const org = await db
    .select()
    .from(organizationEntities)
    .where(eq(organizationEntities.id, resolvedOrgId))
    .limit(1);
  if (!org[0] || org[0].status === "merged") {
    return { ok: false, error: "Organization not found." };
  }

  const existing = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      and(
        eq(personOrganizationAffiliations.personId, personId),
        eq(personOrganizationAffiliations.organizationId, resolvedOrgId),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  const source = params.source ?? "cooccurrence";
  const confidence = params.confidence ?? "medium";
  const evidenceJson = serializeAffiliationEvidence(params.evidence ?? {});

  if (existing[0]) {
    await db
      .update(personOrganizationAffiliations)
      .set({
        status: "denied",
        updatedAt: nowIso,
        reviewedAt: nowIso,
      })
      .where(eq(personOrganizationAffiliations.id, existing[0].id));
    if (
      (
        await db
          .select({ currentOrganizationId: contactPersons.currentOrganizationId })
          .from(contactPersons)
          .where(eq(contactPersons.id, personId))
          .limit(1)
      )[0]?.currentOrganizationId === resolvedOrgId
    ) {
      await setCurrentOrganizationPointer({ personId, organizationId: null });
    }
    return { ok: true, id: existing[0].id };
  }

  const id = randomUUID();
  await db.insert(personOrganizationAffiliations).values({
    id,
    personId,
    organizationId: resolvedOrgId,
    organizationKey: org[0].identityKey,
    relationType: "employed_at",
    status: "denied",
    source,
    confidence,
    evidenceJson,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedAt: nowIso,
  });
  return { ok: true, id };
}

/**
 * When org A is absorbed into org B, rewrite affiliation organization_id /
 * organization_key onto the survivor and collapse duplicate pairs.
 */
export async function rewriteAffiliationsForOrgMerge(params: {
  absorbedOrganizationId: string;
  survivorOrganizationId: string;
  survivorIdentityKey: string;
}): Promise<{ rewritten: number; collapsed: number }> {
  if (params.absorbedOrganizationId === params.survivorOrganizationId) {
    return { rewritten: 0, collapsed: 0 };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  const absorbedRows = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      eq(
        personOrganizationAffiliations.organizationId,
        params.absorbedOrganizationId,
      ),
    );

  let rewritten = 0;
  let collapsed = 0;

  for (const row of absorbedRows) {
    const survivorExisting = await db
      .select()
      .from(personOrganizationAffiliations)
      .where(
        and(
          eq(personOrganizationAffiliations.personId, row.personId),
          eq(
            personOrganizationAffiliations.organizationId,
            params.survivorOrganizationId,
          ),
        ),
      )
      .limit(1);

    if (survivorExisting[0]) {
      // Keep the stronger status: approved > pending > denied
      const rank = (s: string) =>
        s === "approved" ? 3 : s === "pending" ? 2 : 1;
      const keepAbsorbed = rank(row.status) > rank(survivorExisting[0].status);
      if (keepAbsorbed) {
        await db
          .update(personOrganizationAffiliations)
          .set({
            status: row.status,
            source: row.source,
            confidence: row.confidence,
            evidenceJson: row.evidenceJson,
            organizationKey: params.survivorIdentityKey,
            updatedAt: nowIso,
            reviewedAt: row.reviewedAt,
          })
          .where(eq(personOrganizationAffiliations.id, survivorExisting[0].id));
      }
      await db
        .delete(personOrganizationAffiliations)
        .where(eq(personOrganizationAffiliations.id, row.id));
      collapsed += 1;
    } else {
      await db
        .update(personOrganizationAffiliations)
        .set({
          organizationId: params.survivorOrganizationId,
          organizationKey: params.survivorIdentityKey,
          updatedAt: nowIso,
        })
        .where(eq(personOrganizationAffiliations.id, row.id));
      rewritten += 1;
    }

    // Fix denormalized pointer
    const person = await db
      .select({ currentOrganizationId: contactPersons.currentOrganizationId })
      .from(contactPersons)
      .where(eq(contactPersons.id, row.personId))
      .limit(1);
    if (person[0]?.currentOrganizationId === params.absorbedOrganizationId) {
      await setCurrentOrganizationPointer({
        personId: row.personId,
        organizationId: params.survivorOrganizationId,
      });
    }
  }

  return { rewritten, collapsed };
}

/**
 * When person A is absorbed into person B, rewrite affiliation person_id onto
 * the survivor and collapse duplicate org pairs.
 */
export async function rewriteAffiliationsForPersonMerge(params: {
  absorbedPersonId: string;
  survivorPersonId: string;
}): Promise<{ rewritten: number; collapsed: number }> {
  if (params.absorbedPersonId === params.survivorPersonId) {
    return { rewritten: 0, collapsed: 0 };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  const absorbedRows = await db
    .select()
    .from(personOrganizationAffiliations)
    .where(
      eq(personOrganizationAffiliations.personId, params.absorbedPersonId),
    );

  let rewritten = 0;
  let collapsed = 0;

  for (const row of absorbedRows) {
    const survivorExisting = await db
      .select()
      .from(personOrganizationAffiliations)
      .where(
        and(
          eq(personOrganizationAffiliations.personId, params.survivorPersonId),
          eq(
            personOrganizationAffiliations.organizationId,
            row.organizationId,
          ),
        ),
      )
      .limit(1);

    if (survivorExisting[0]) {
      const rank = (s: string) =>
        s === "approved" ? 3 : s === "pending" ? 2 : 1;
      const keepAbsorbed = rank(row.status) > rank(survivorExisting[0].status);
      if (keepAbsorbed) {
        await db
          .update(personOrganizationAffiliations)
          .set({
            status: row.status,
            source: row.source,
            confidence: row.confidence,
            evidenceJson: row.evidenceJson,
            updatedAt: nowIso,
            reviewedAt: row.reviewedAt,
          })
          .where(eq(personOrganizationAffiliations.id, survivorExisting[0].id));
      }
      await db
        .delete(personOrganizationAffiliations)
        .where(eq(personOrganizationAffiliations.id, row.id));
      collapsed += 1;
    } else {
      await db
        .update(personOrganizationAffiliations)
        .set({
          personId: params.survivorPersonId,
          updatedAt: nowIso,
        })
        .where(eq(personOrganizationAffiliations.id, row.id));
      rewritten += 1;
    }
  }

  // Prefer survivor's current org; else take absorbed pointer.
  const [survivor, absorbed] = await Promise.all([
    db
      .select({ currentOrganizationId: contactPersons.currentOrganizationId })
      .from(contactPersons)
      .where(eq(contactPersons.id, params.survivorPersonId))
      .limit(1),
    db
      .select({ currentOrganizationId: contactPersons.currentOrganizationId })
      .from(contactPersons)
      .where(eq(contactPersons.id, params.absorbedPersonId))
      .limit(1),
  ]);
  if (!survivor[0]?.currentOrganizationId && absorbed[0]?.currentOrganizationId) {
    await setCurrentOrganizationPointer({
      personId: params.survivorPersonId,
      organizationId: absorbed[0].currentOrganizationId,
    });
  }

  return { rewritten, collapsed };
}
