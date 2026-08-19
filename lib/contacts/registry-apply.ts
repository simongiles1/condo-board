/** Persist contact registry persons, occupancy rows, and email index. */

import { randomUUID } from "crypto";

import { eq, inArray, or, sql } from "drizzle-orm";

import { rewriteAffiliationsForPersonMerge } from "@/lib/affiliations/apply";
import {
  contactFieldValueIsDenied,
  loadContactFieldDenialsForPersons,
} from "@/lib/contacts/field-denials";
import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactFingerprintMerges,
  contactHighlightExtractions,
  contactMergeProposals,
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
} from "@/lib/db/schema";
import { normalizePhone } from "@/lib/email/entity-dedup";
import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";
import {
  collectDiscardedNameAliases,
  finalizeNameAliases,
  givenNamesConflict,
  guessFirstNameFromDottedLocalPart,
  hasStrongIdentity,
  isGivenNameInitialExpansion,
  isGivenNameSpellingVariant,
  isNamelessPerson,
  isNameMatchingEmailLocalPart,
  isSparseFirstNameOnly,
  isWeakNameVariantOf,
  lastNamesCompatible,
  looksLikeMailboxLocalPart,
  mergeEmailOccupancyDates,
  mergeEvidence,
  mergeNameAliasLists,
  normalizeContactRegistryEmail,
  planMailboxIdentityMerges,
  normalizeGivenNameToken,
  occupancyCoversAt,
  parseEvidenceJson,
  parseNameAliasesJson,
  personDisplayName,
  personIdentitiesConflict,
  preferCompatibleLastName,
  preferPersonGivenName,
  pickCurrentOccupancyPersonId,
  planSharedMailboxSuccession,
  sanitizeGivenNameAgainstEmails,
  serializeNameAliasesJson,
  titleCaseGivenName,
  type ContactAdjudicationDecision,
  type ContactRegistryEvidence,
  type ContactRegistryIncomingCard,
} from "@/lib/contacts/registry-shared";

async function refreshEmailIndex(
  emails: string[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const normalized = [
    ...new Set(
      emails.map((e) => normalizeContactRegistryEmail(e)).filter(Boolean),
    ),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  const rows = await db
    .select({
      email: contactPersonEmails.email,
      personId: contactPersonEmails.personId,
      validFrom: contactPersonEmails.validFrom,
      validTo: contactPersonEmails.validTo,
    })
    .from(contactPersonEmails)
    .where(inArray(contactPersonEmails.email, normalized));

  const byEmail = new Map<
    string,
    Array<{ personId: string; validFrom: string | null; validTo: string | null }>
  >();
  for (const row of rows) {
    const key = normalizeContactRegistryEmail(row.email);
    const list = byEmail.get(key) ?? [];
    list.push({
      personId: row.personId,
      validFrom: row.validFrom,
      validTo: row.validTo,
    });
    byEmail.set(key, list);
  }

  for (const email of normalized) {
    const currentPersonId = pickCurrentOccupancyPersonId(
      byEmail.get(email) ?? [],
      nowIso,
    );
    const existing = await db
      .select({ email: contactEmailIndex.email })
      .from(contactEmailIndex)
      .where(eq(contactEmailIndex.email, email))
      .limit(1);

    if (existing[0]) {
      await db
        .update(contactEmailIndex)
        .set({ currentPersonId, updatedAt: nowIso })
        .where(eq(contactEmailIndex.email, email));
    } else {
      await db.insert(contactEmailIndex).values({
        email,
        currentPersonId,
        updatedAt: nowIso,
      });
    }
  }
}

async function appendEmailOccupancy(params: {
  personId: string;
  email: string;
  validFrom: string | null;
  validTo: string | null;
  evidence: ContactRegistryEvidence[];
  nowIso: string;
}): Promise<void> {
  const email = normalizeContactRegistryEmail(params.email);
  if (!email) return;

  const denialsByPerson = await loadContactFieldDenialsForPersons([
    params.personId,
  ]);
  if (
    contactFieldValueIsDenied(
      denialsByPerson.get(params.personId) ?? [],
      "email",
      email,
    )
  ) {
    return;
  }

  const db = getDb();

  const existing = await db
    .select()
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.personId, params.personId));

  const match = existing.find(
    (row) => normalizeContactRegistryEmail(row.email) === email,
  );

  if (match) {
    const evidence = mergeEvidence(
      parseEvidenceJson(match.evidenceJson),
      params.evidence,
    );
    const { validFrom, validTo } = mergeEmailOccupancyDates({
      existingFrom: match.validFrom,
      existingTo: match.validTo,
      incomingFrom: params.validFrom,
      incomingTo: params.validTo,
    });
    await db
      .update(contactPersonEmails)
      .set({
        validFrom,
        validTo,
        evidenceJson: JSON.stringify(evidence),
        updatedAt: params.nowIso,
      })
      .where(eq(contactPersonEmails.id, match.id));
  } else {
    await db.insert(contactPersonEmails).values({
      id: randomUUID(),
      personId: params.personId,
      email,
      validFrom: params.validFrom,
      validTo: params.validTo,
      evidenceJson: JSON.stringify(params.evidence),
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
    });
  }

  await applySharedMailboxSuccession(email, params.nowIso);
  await refreshEmailIndex([email], params.nowIso);
}

async function applySharedMailboxSuccession(
  email: string,
  nowIso: string,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: contactPersonEmails.id,
      personId: contactPersonEmails.personId,
      validFrom: contactPersonEmails.validFrom,
      validTo: contactPersonEmails.validTo,
    })
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.email, email));

  const personIds = new Set(rows.map((row) => row.personId));
  if (personIds.size < 2) return;

  const updates = planSharedMailboxSuccession(rows);
  for (const update of updates) {
    await db
      .update(contactPersonEmails)
      .set({ validTo: update.validTo, updatedAt: nowIso })
      .where(eq(contactPersonEmails.id, update.id));
  }
}

/** Close stale shared-mailbox occupants; latest evidence stays "present". */
export async function repairSharedMailboxOccupancy(): Promise<{
  emails: number;
  rowsUpdated: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = await db
    .select({
      id: contactPersonEmails.id,
      email: contactPersonEmails.email,
      personId: contactPersonEmails.personId,
      validFrom: contactPersonEmails.validFrom,
      validTo: contactPersonEmails.validTo,
    })
    .from(contactPersonEmails);

  const byEmail = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = normalizeContactRegistryEmail(row.email);
    const list = byEmail.get(key) ?? [];
    list.push(row);
    byEmail.set(key, list);
  }

  let emails = 0;
  let rowsUpdated = 0;
  const touched: string[] = [];
  for (const [email, list] of byEmail) {
    const personIds = new Set(list.map((row) => row.personId));
    if (personIds.size < 2) continue;
    emails += 1;
    const updates = planSharedMailboxSuccession(list);
    for (const update of updates) {
      await db
        .update(contactPersonEmails)
        .set({ validTo: update.validTo, updatedAt: nowIso })
        .where(eq(contactPersonEmails.id, update.id));
      rowsUpdated += 1;
    }
    if (updates.length > 0) touched.push(email);
  }
  if (touched.length > 0) {
    await refreshEmailIndex(touched, nowIso);
  }
  return { emails, rowsUpdated };
}

async function appendPhone(params: {
  personId: string;
  phone: string;
  validFrom: string | null;
  validTo: string | null;
  evidence: ContactRegistryEvidence[];
  nowIso: string;
}): Promise<void> {
  const phone = params.phone.trim();
  const phoneNormalized = normalizePhone(phone);
  if (!phone || phoneNormalized.length < 7) return;
  const db = getDb();

  const existing = await db
    .select()
    .from(contactPersonPhones)
    .where(eq(contactPersonPhones.personId, params.personId));
  const match = existing.find((r) => r.phoneNormalized === phoneNormalized);
  if (match) {
    const evidence = mergeEvidence(
      parseEvidenceJson(match.evidenceJson),
      params.evidence,
    );
    await db
      .update(contactPersonPhones)
      .set({
        evidenceJson: JSON.stringify(evidence),
        updatedAt: params.nowIso,
      })
      .where(eq(contactPersonPhones.id, match.id));
    return;
  }

  await db.insert(contactPersonPhones).values({
    id: randomUUID(),
    personId: params.personId,
    phone,
    phoneNormalized,
    validFrom: params.validFrom,
    validTo: params.validTo,
    evidenceJson: JSON.stringify(params.evidence),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  });
}

async function appendTitle(params: {
  personId: string;
  title: string;
  validFrom: string | null;
  validTo: string | null;
  evidence: ContactRegistryEvidence[];
  nowIso: string;
}): Promise<void> {
  const title = params.title.trim();
  if (!title) return;
  const db = getDb();

  const existing = await db
    .select()
    .from(contactPersonTitles)
    .where(eq(contactPersonTitles.personId, params.personId));
  const match = existing.find(
    (r) => r.title.trim().toLowerCase() === title.toLowerCase(),
  );
  if (match) {
    const evidence = mergeEvidence(
      parseEvidenceJson(match.evidenceJson),
      params.evidence,
    );
    const validFrom =
      [match.validFrom, params.validFrom].filter(Boolean).sort()[0] ?? null;
    let validTo = match.validTo;
    if (params.validTo === null) validTo = null;
    else if (params.validTo && match.validTo) {
      validTo =
        params.validTo > match.validTo ? params.validTo : match.validTo;
    }
    await db
      .update(contactPersonTitles)
      .set({
        validFrom,
        validTo,
        evidenceJson: JSON.stringify(evidence),
        updatedAt: params.nowIso,
      })
      .where(eq(contactPersonTitles.id, match.id));
    return;
  }

  // Close previous open title if dates suggest succession.
  if (params.validFrom) {
    for (const row of existing) {
      if (row.validTo == null) {
        await db
          .update(contactPersonTitles)
          .set({
            validTo: params.validFrom,
            updatedAt: params.nowIso,
          })
          .where(eq(contactPersonTitles.id, row.id));
      }
    }
  }

  await db.insert(contactPersonTitles).values({
    id: randomUUID(),
    personId: params.personId,
    title,
    validFrom: params.validFrom,
    validTo: params.validTo,
    evidenceJson: JSON.stringify(params.evidence),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  });
}

export async function createPersonFromCard(params: {
  card: ContactEntityCard;
  mentionWeight: number;
  evidence: ContactRegistryEvidence[];
  dateMin: string | null;
  dateMax: string | null;
  nowIso?: string;
}): Promise<string> {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const db = getDb();
  const personId = randomUUID();
  const emails = params.card.email?.trim() ? [params.card.email] : [];
  const firstName = sanitizeGivenNameAgainstEmails(
    params.card.first_name,
    emails,
  );
  const lastName = params.card.last_name?.trim() || null;

  await db.insert(contactPersons).values({
    id: personId,
    firstName,
    lastName,
    nameAliasesJson: null,
    mentionWeight: params.mentionWeight,
    sparseStub: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  if (params.card.email?.trim()) {
    await appendEmailOccupancy({
      personId,
      email: params.card.email,
      validFrom: params.dateMin,
      // Bound by last observed evidence unless a later open-ended link says current.
      validTo: params.dateMax,
      evidence: params.evidence,
      nowIso,
    });
  }
  if (params.card.phone?.trim()) {
    await appendPhone({
      personId,
      phone: params.card.phone,
      validFrom: params.dateMin,
      validTo: params.dateMax,
      evidence: params.evidence,
      nowIso,
    });
  }
  if (params.card.job_title?.trim()) {
    await appendTitle({
      personId,
      title: params.card.job_title,
      validFrom: params.dateMin,
      validTo: params.dateMax,
      evidence: params.evidence,
      nowIso,
    });
  }

  return personId;
}

async function enrichPersonFromCard(params: {
  personId: string;
  card: ContactEntityCard;
  mentionWeightDelta: number;
  evidence: ContactRegistryEvidence[];
  dateMin: string | null;
  dateMax: string | null;
  emailOverride?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  nowIso: string;
}): Promise<void> {
  const db = getDb();
  const [person] = await db
    .select()
    .from(contactPersons)
    .where(eq(contactPersons.id, params.personId))
    .limit(1);
  if (!person) return;

  const denials = (
    await loadContactFieldDenialsForPersons([params.personId])
  ).get(params.personId) ?? [];

  const existingEmails = await db
    .select({ email: contactPersonEmails.email })
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.personId, params.personId));
  const emailForAttach = params.emailOverride ?? params.card.email;
  const emails = [
    ...existingEmails.map((r) => r.email),
    emailForAttach,
    params.card.email,
  ];

  const firstNamePreferred = sanitizeGivenNameAgainstEmails(
    preferPersonGivenName(person.firstName, params.card.first_name, emails),
    emails,
  );
  const existingFirst = person.firstName?.trim() || null;
  const incomingFirst = params.card.first_name?.trim() || null;
  const namesConflict = givenNamesConflict(existingFirst, incomingFirst);

  let firstName = firstNamePreferred;
  // Conflicting real names (Paul vs Peter): evidence majority overrides
  // keep-existing so a stuck wrong primary cannot lock forever during ingest.
  // Votes are scoped to this person's last name so shared role mailboxes
  // (studiopm@…) cannot flip Mehal → Atif or Margot → Atif.
  if (namesConflict) {
    const votes = await gatherGivenNameVotesForEmails(emails, {
      lastName: preferCompatibleLastName(person.lastName, params.card.last_name),
    });
    firstName = applyEvidenceGivenNameOverride({
      current: firstNamePreferred,
      emails,
      votes,
    });
  }

  const lastName = preferCompatibleLastName(person.lastName, params.card.last_name);
  const nameAliasesJson = serializeNameAliasesJson(
    finalizeNameAliases({
      kept: firstName,
      lists: [
        parseNameAliasesJson(person.nameAliasesJson).filter(
          (alias) => !contactFieldValueIsDenied(denials, "name_alias", alias),
        ),
        collectDiscardedNameAliases({
          kept: firstName,
          candidates: [person.firstName, params.card.first_name],
          emails,
        }).filter(
          (alias) => !contactFieldValueIsDenied(denials, "name_alias", alias),
        ),
      ],
    }),
  );
  const sparseStub = isSparseFirstNameOnly({
    first_name: firstName,
    last_name: lastName,
    email: params.card.email,
    phone: params.card.phone,
  }) && !hasStrongIdentity({
    first_name: firstName,
    last_name: lastName,
    email: params.card.email ?? params.emailOverride,
    phone: params.card.phone,
  });

  await db
    .update(contactPersons)
    .set({
      firstName,
      lastName,
      nameAliasesJson,
      mentionWeight: person.mentionWeight + Math.max(0, params.mentionWeightDelta),
      sparseStub,
      updatedAt: params.nowIso,
    })
    .where(eq(contactPersons.id, params.personId));

  const email = params.emailOverride ?? params.card.email;
  if (email?.trim()) {
    await appendEmailOccupancy({
      personId: params.personId,
      email,
      validFrom: params.validFrom ?? params.dateMin,
      validTo:
        params.validTo === undefined ? params.dateMax : params.validTo,
      evidence: params.evidence,
      nowIso: params.nowIso,
    });
  }
  if (params.card.phone?.trim()) {
    await appendPhone({
      personId: params.personId,
      phone: params.card.phone,
      validFrom: params.dateMin,
      validTo: params.dateMax,
      evidence: params.evidence,
      nowIso: params.nowIso,
    });
  }
  if (params.card.job_title?.trim()) {
    await appendTitle({
      personId: params.personId,
      title: params.card.job_title,
      validFrom: params.dateMin,
      validTo: params.dateMax,
      evidence: params.evidence,
      nowIso: params.nowIso,
    });
  }
}

async function mergePersons(params: {
  survivorId: string;
  absorbedId: string;
  nowIso: string;
}): Promise<void> {
  if (params.survivorId === params.absorbedId) return;
  const db = getDb();

  const [survivor, absorbed] = await Promise.all([
    db
      .select()
      .from(contactPersons)
      .where(eq(contactPersons.id, params.survivorId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(contactPersons)
      .where(eq(contactPersons.id, params.absorbedId))
      .limit(1)
      .then((r) => r[0]),
  ]);
  if (!survivor || !absorbed) return;

  // Load emails before choosing names so local-part first names lose to real ones.
  const emailRows = await db
    .select({
      personId: contactPersonEmails.personId,
      email: contactPersonEmails.email,
    })
    .from(contactPersonEmails)
    .where(
      inArray(contactPersonEmails.personId, [
        params.survivorId,
        params.absorbedId,
      ]),
    );
  const emails = emailRows.map((r) => r.email);

  const firstNamePreferred = sanitizeGivenNameAgainstEmails(
    preferPersonGivenName(survivor.firstName, absorbed.firstName, emails),
    emails,
  );
  const survivorFirst = survivor.firstName?.trim() || null;
  const absorbedFirst = absorbed.firstName?.trim() || null;
  const namesConflict = givenNamesConflict(survivorFirst, absorbedFirst);

  let firstName = firstNamePreferred;
  if (namesConflict) {
    const votes = await gatherGivenNameVotesForEmails(emails, {
      lastName: preferCompatibleLastName(survivor.lastName, absorbed.lastName),
    });
    firstName = applyEvidenceGivenNameOverride({
      current: firstNamePreferred,
      emails,
      votes,
    });
  }
  const lastName = preferCompatibleLastName(survivor.lastName, absorbed.lastName);
  const nameAliasesJson = serializeNameAliasesJson(
    finalizeNameAliases({
      kept: firstName,
      lists: [
        parseNameAliasesJson(survivor.nameAliasesJson),
        parseNameAliasesJson(absorbed.nameAliasesJson),
        collectDiscardedNameAliases({
          kept: firstName,
          candidates: [survivor.firstName, absorbed.firstName],
          emails,
        }),
      ],
    }),
  );

  await db
    .update(contactPersons)
    .set({
      firstName,
      lastName,
      nameAliasesJson,
      mentionWeight: survivor.mentionWeight + absorbed.mentionWeight,
      sparseStub: survivor.sparseStub && absorbed.sparseStub,
      updatedAt: params.nowIso,
    })
    .where(eq(contactPersons.id, params.survivorId));

  const absorbedEmailOccupancy = await db
    .select()
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.personId, params.absorbedId));
  for (const row of absorbedEmailOccupancy) {
    await appendEmailOccupancy({
      personId: params.survivorId,
      email: row.email,
      validFrom: row.validFrom,
      validTo: row.validTo,
      evidence: parseEvidenceJson(row.evidenceJson),
      nowIso: params.nowIso,
    });
  }

  const phones = await db
    .select()
    .from(contactPersonPhones)
    .where(eq(contactPersonPhones.personId, params.absorbedId));
  for (const row of phones) {
    await appendPhone({
      personId: params.survivorId,
      phone: row.phone,
      validFrom: row.validFrom,
      validTo: row.validTo,
      evidence: parseEvidenceJson(row.evidenceJson),
      nowIso: params.nowIso,
    });
  }

  const titles = await db
    .select()
    .from(contactPersonTitles)
    .where(eq(contactPersonTitles.personId, params.absorbedId));
  for (const row of titles) {
    await appendTitle({
      personId: params.survivorId,
      title: row.title,
      validFrom: row.validFrom,
      validTo: row.validTo,
      evidence: parseEvidenceJson(row.evidenceJson),
      nowIso: params.nowIso,
    });
  }

  await rewriteAffiliationsForPersonMerge({
    absorbedPersonId: params.absorbedId,
    survivorPersonId: params.survivorId,
  });

  await db
    .delete(contactPersons)
    .where(eq(contactPersons.id, params.absorbedId));
}

export async function applyAdjudicationDecisions(params: {
  incoming: ContactRegistryIncomingCard[];
  decisions: ContactAdjudicationDecision[];
  modelId: string | null;
  fingerprintMergeId: string | null;
}): Promise<{
  personsCreated: number;
  decisionsApplied: number;
  resultPersonIds: string[];
}> {
  const nowIso = new Date().toISOString();
  const db = getDb();
  const byTemp = new Map(params.incoming.map((c) => [c.tempId, c]));
  let personsCreated = 0;
  let decisionsApplied = 0;
  const resultPersonIds: string[] = [];

  // Process high mention weight first (Pareto).
  const ordered = [...params.decisions].sort((a, b) => {
    const wa = byTemp.get(a.incomingTempId)?.mentionWeight ?? 0;
    const wb = byTemp.get(b.incomingTempId)?.mentionWeight ?? 0;
    return wb - wa;
  });

  for (const decision of ordered) {
    const card = byTemp.get(decision.incomingTempId);
    if (!card) continue;
    let recordedDecision = decision;

    const evidence: ContactRegistryEvidence[] = card.sourceEmailIds.map(
      (emailId) => ({
        emailId,
        receivedAt: card.dateMax,
        mergeId: params.fingerprintMergeId,
      }),
    );

    let resultPersonId: string | null = null;

    // Hard guard: never merge/enrich distinct humans who share a role mailbox
    // into one person (Margot/Atif/Mehal/Haider on studiopm@…).
    if (
      (recordedDecision.action === "merge" ||
        recordedDecision.action === "enrich") &&
      recordedDecision.targetPersonId &&
      !isSparseFirstNameOnly(card)
    ) {
      const [target] = await db
        .select({
          id: contactPersons.id,
          firstName: contactPersons.firstName,
          lastName: contactPersons.lastName,
        })
        .from(contactPersons)
        .where(eq(contactPersons.id, recordedDecision.targetPersonId))
        .limit(1);
      if (target && personIdentitiesConflict(card, target)) {
        recordedDecision = {
          ...recordedDecision,
          action: "link_email",
          email:
            recordedDecision.email?.trim() ||
            card.email?.trim() ||
            null,
          validFrom: recordedDecision.validFrom ?? card.dateMin,
          validTo:
            recordedDecision.validTo === undefined
              ? card.dateMax
              : recordedDecision.validTo,
          reason:
            recordedDecision.reason != null
              ? `${recordedDecision.reason}; forced_link_email_distinct_identity`
              : "forced_link_email_distinct_identity",
        };
      }
    }

    if (
      recordedDecision.action === "merge" &&
      recordedDecision.targetPersonId &&
      !isSparseFirstNameOnly(card)
    ) {
      await enrichPersonFromCard({
        personId: recordedDecision.targetPersonId,
        card,
        mentionWeightDelta: card.mentionWeight,
        evidence,
        dateMin: card.dateMin,
        dateMax: card.dateMax,
        validFrom: card.dateMin,
        validTo: card.dateMax,
        nowIso,
      });
      resultPersonId = recordedDecision.targetPersonId;
    } else if (
      recordedDecision.action === "enrich" &&
      recordedDecision.targetPersonId
    ) {
      await enrichPersonFromCard({
        personId: recordedDecision.targetPersonId,
        card,
        mentionWeightDelta: card.mentionWeight,
        evidence,
        dateMin: card.dateMin,
        dateMax: card.dateMax,
        emailOverride: recordedDecision.email,
        validFrom: recordedDecision.validFrom ?? card.dateMin,
        validTo:
          recordedDecision.validTo === undefined
            ? card.dateMax
            : recordedDecision.validTo,
        nowIso,
      });
      resultPersonId = recordedDecision.targetPersonId;
    } else if (recordedDecision.action === "link_email") {
      // Create incoming as its own person, then attach shared mailbox with ranges.
      resultPersonId = await createPersonFromCard({
        card: {
          ...card,
          // Avoid double-attaching email with open-ended range before link dates.
          email: null,
        },
        mentionWeight: card.mentionWeight,
        evidence,
        dateMin: card.dateMin,
        dateMax: card.dateMax,
        nowIso,
      });
      personsCreated += 1;

      const email =
        recordedDecision.email?.trim() ||
        card.email?.trim() ||
        null;
      if (email) {
        const linkValidTo =
          recordedDecision.validTo === undefined
            ? card.dateMax
            : recordedDecision.validTo;
        await appendEmailOccupancy({
          personId: resultPersonId,
          email,
          validFrom: recordedDecision.validFrom ?? card.dateMin,
          validTo: linkValidTo,
          evidence,
          nowIso,
        });

        // If target exists and also should keep the address historically, close
        // their open interval when link says incoming is current.
        if (
          recordedDecision.targetPersonId &&
          (linkValidTo === null || linkValidTo === undefined)
        ) {
          const targetEmails = await db
            .select()
            .from(contactPersonEmails)
            .where(
              eq(contactPersonEmails.personId, recordedDecision.targetPersonId),
            );
          const key = normalizeContactRegistryEmail(email);
          for (const row of targetEmails) {
            if (
              normalizeContactRegistryEmail(row.email) === key &&
              row.validTo == null
            ) {
              const closeAt = recordedDecision.validFrom ?? card.dateMin;
              if (closeAt) {
                await db
                  .update(contactPersonEmails)
                  .set({ validTo: closeAt, updatedAt: nowIso })
                  .where(eq(contactPersonEmails.id, row.id));
              }
            }
          }
          await refreshEmailIndex([key], nowIso);
        }
      }
    } else {
      // keep_separate — but fold email-only / weak-name stubs into an existing
      // occupant of the same mailbox instead of minting duplicate "Studio PM" people.
      const email = card.email?.trim() || null;
      let foldIntoId: string | null = null;
      if (email) {
        const owners = await findPersonsSharingEmail(email);
        if (owners.length > 0) {
          if (isNamelessPerson(card)) {
            foldIntoId =
              pickBestEmailOwnerAtTime(owners, card.dateMin ?? card.dateMax)
                ?.id ?? null;
          } else {
            const weakMatch = owners.find((owner) =>
              isWeakNameVariantOf(card, owner),
            );
            if (weakMatch) foldIntoId = weakMatch.id;
          }
        }
      }

      if (foldIntoId) {
        await enrichPersonFromCard({
          personId: foldIntoId,
          card,
          mentionWeightDelta: card.mentionWeight,
          evidence,
          dateMin: card.dateMin,
          dateMax: card.dateMax,
          nowIso,
        });
        resultPersonId = foldIntoId;
        recordedDecision = {
          ...recordedDecision,
          action: "enrich",
          targetPersonId: foldIntoId,
          reason:
            recordedDecision.reason != null
              ? `${recordedDecision.reason}; folded_duplicate_mailbox_stub`
              : "folded_duplicate_mailbox_stub",
        };
      } else {
        resultPersonId = await createPersonFromCard({
          card,
          mentionWeight: card.mentionWeight,
          evidence,
          dateMin: card.dateMin,
          dateMax: card.dateMax,
          nowIso,
        });
        personsCreated += 1;
      }
    }

    await db.insert(contactMergeProposals).values({
      id: randomUUID(),
      action: recordedDecision.action,
      incomingCardJson: JSON.stringify(card),
      targetPersonId: recordedDecision.targetPersonId,
      resultPersonId,
      decisionJson: JSON.stringify(recordedDecision),
      modelId: params.modelId,
      fingerprintMergeId: params.fingerprintMergeId,
      createdAt: nowIso,
    });
    if (resultPersonId) resultPersonIds.push(resultPersonId);
    decisionsApplied += 1;
  }

  return { personsCreated, decisionsApplied, resultPersonIds };
}

async function findPersonsSharingEmail(email: string): Promise<
  Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    mentionWeight: number;
    validFrom: string | null;
    validTo: string | null;
  }>
> {
  const db = getDb();
  const key = normalizeContactRegistryEmail(email);
  const rows = await db
    .select({
      personId: contactPersonEmails.personId,
      validFrom: contactPersonEmails.validFrom,
      validTo: contactPersonEmails.validTo,
    })
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.email, key));
  const personIds = [...new Set(rows.map((r) => r.personId))];
  if (personIds.length === 0) return [];
  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      mentionWeight: contactPersons.mentionWeight,
    })
    .from(contactPersons)
    .where(inArray(contactPersons.id, personIds));

  // Prefer the widest occupancy window per person for time-aware stub folding.
  const occupancyByPerson = new Map<
    string,
    { validFrom: string | null; validTo: string | null }
  >();
  for (const row of rows) {
    const prev = occupancyByPerson.get(row.personId);
    if (!prev) {
      occupancyByPerson.set(row.personId, {
        validFrom: row.validFrom,
        validTo: row.validTo,
      });
      continue;
    }
    const validFrom =
      [prev.validFrom, row.validFrom].filter(Boolean).sort()[0] ?? null;
    let validTo = prev.validTo;
    if (prev.validTo == null || row.validTo == null) {
      validTo = null;
    } else {
      validTo = prev.validTo > row.validTo ? prev.validTo : row.validTo;
    }
    occupancyByPerson.set(row.personId, { validFrom, validTo });
  }

  return persons.map((person) => {
    const occ = occupancyByPerson.get(person.id);
    return {
      ...person,
      validFrom: occ?.validFrom ?? null,
      validTo: occ?.validTo ?? null,
    };
  });
}

function pickBestEmailOwner(
  owners: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    mentionWeight: number;
  }>,
): (typeof owners)[number] {
  return [...owners].sort((a, b) => {
    const score = (p: (typeof owners)[number]) => {
      if (p.firstName?.trim() && p.lastName?.trim()) return 2;
      if (p.firstName?.trim() || p.lastName?.trim()) return 1;
      return 0;
    };
    const aNamed = score(a);
    const bNamed = score(b);
    if (bNamed !== aNamed) return bNamed - aNamed;
    const aLast = a.lastName?.trim().length ?? 0;
    const bLast = b.lastName?.trim().length ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return b.mentionWeight - a.mentionWeight;
  })[0]!;
}

/** Prefer an occupant whose email tenure covers `at`, else no fold target. */
function pickBestEmailOwnerAtTime<
  T extends {
    id: string;
    firstName: string | null;
    lastName: string | null;
    mentionWeight: number;
    validFrom: string | null;
    validTo: string | null;
  },
>(owners: T[], at: string | null | undefined): T | null {
  if (!at?.trim()) return null;
  const covering = owners.filter((owner) =>
    occupancyCoversAt(owner.validFrom, owner.validTo, at),
  );
  if (covering.length === 0) return null;
  return pickBestEmailOwner(covering) as T;
}

type EntityCardLike = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

function parseEntityCardsJson(raw: string | null | undefined): EntityCardLike[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as EntityCardLike[];
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { entity_cards?: unknown }).entity_cards)
    ) {
      return (parsed as { entity_cards: EntityCardLike[] }).entity_cards;
    }
  } catch {
    /* ignore */
  }
  return [];
}

type GivenNameVoteBucket = Map<
  string,
  Map<string, { count: number; lastName: string | null }>
>;

function tallyGivenNameVote(
  votes: GivenNameVoteBucket,
  email: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined = null,
): void {
  const key = normalizeContactRegistryEmail(email ?? "");
  const first = firstName?.trim() || null;
  if (!key || !first) return;
  if (isNameMatchingEmailLocalPart(first, [email])) return;
  if (looksLikeMailboxLocalPart(first) && first.length >= 7) return;
  // Skip bare initials like "P" / "P."
  if (/^[a-z]\.?$/i.test(first)) return;

  const display = titleCaseGivenName(first);
  const byName = votes.get(key) ?? new Map();
  const prev = byName.get(display);
  const nextLast =
    preferCompatibleLastName(prev?.lastName ?? null, lastName) ??
    (lastName?.trim() || null);
  byName.set(display, {
    count: (prev?.count ?? 0) + 1,
    lastName: nextLast,
  });
  votes.set(key, byName);
}

/**
 * Combined given-name vote counts across fingerprint + third-pass cards for the
 * given mailbox addresses. When `lastName` is set, only count cards whose last
 * name is compatible (stops studiopm@ Atif/Margot/Mehal cross-contamination).
 */
async function gatherGivenNameVotesForEmails(
  emails: Array<string | null | undefined>,
  opts?: { lastName?: string | null },
): Promise<Map<string, number>> {
  const normalized = [
    ...new Set(
      emails.map((e) => normalizeContactRegistryEmail(e ?? "")).filter(Boolean),
    ),
  ];
  const combined = new Map<string, number>();
  if (normalized.length === 0) return combined;

  const db = getDb();
  const patterns = normalized.map((email) => `%${email}%`);
  const votes: GivenNameVoteBucket = new Map();
  const chunkSize = 25;
  for (let i = 0; i < patterns.length; i += chunkSize) {
    const chunk = patterns.slice(i, i + chunkSize);
    const fpMatch = or(
      ...chunk.map(
        (p) => sql`${contactFingerprintMerges.entityCardsJson} ILIKE ${p}`,
      ),
    );
    const fpRows = fpMatch
      ? await db
          .select({ entityCardsJson: contactFingerprintMerges.entityCardsJson })
          .from(contactFingerprintMerges)
          .where(fpMatch)
      : [];
    for (const row of fpRows) {
      for (const card of parseEntityCardsJson(row.entityCardsJson)) {
        tallyGivenNameVote(votes, card.email, card.first_name, card.last_name);
      }
    }

    const thirdMatch = or(
      ...chunk.map(
        (p) =>
          sql`${contactHighlightExtractions.thirdPassExtractionJson} ILIKE ${p}`,
      ),
    );
    const thirdRows = thirdMatch
      ? await db
          .select({
            thirdPassExtractionJson:
              contactHighlightExtractions.thirdPassExtractionJson,
          })
          .from(contactHighlightExtractions)
          .where(thirdMatch)
      : [];
    for (const row of thirdRows) {
      for (const card of parseEntityCardsJson(row.thirdPassExtractionJson)) {
        tallyGivenNameVote(votes, card.email, card.first_name, card.last_name);
      }
    }
  }

  const scopeLast = opts?.lastName?.trim() || null;
  for (const email of normalized) {
    const byName = votes.get(email);
    if (!byName) continue;
    for (const [name, entry] of byName) {
      if (
        scopeLast &&
        entry.lastName &&
        !lastNamesCompatible(scopeLast, entry.lastName)
      ) {
        continue;
      }
      combined.set(name, (combined.get(name) ?? 0) + entry.count);
    }
  }
  return combined;
}

/** Majority given name from vote map; null when no name has ≥2 hits. */
function pickMajorityGivenName(votes: Map<string, number>): {
  name: string;
  count: number;
} | null {
  let bestName: string | null = null;
  let bestCount = 0;
  for (const [name, count] of votes) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  if (!bestName || bestCount < 2) return null;
  return { name: bestName, count: bestCount };
}

/**
 * When stored vs incoming given names conflict, prefer clear evidence majority
 * (Paul ≫ Peter) so a stuck wrong primary cannot lock forever under
 * keep-existing prefer rules.
 */
function applyEvidenceGivenNameOverride(params: {
  current: string | null;
  emails: Array<string | null | undefined>;
  votes: Map<string, number>;
}): string | null {
  const majority = pickMajorityGivenName(params.votes);
  if (!majority) return params.current;

  const current = params.current?.trim() || null;
  if (!current) {
    return (
      sanitizeGivenNameAgainstEmails(majority.name, params.emails) ?? current
    );
  }
  if (normalizeGivenNameToken(current) === normalizeGivenNameToken(majority.name)) {
    return current;
  }
  if (isGivenNameSpellingVariant(current, majority.name)) {
    return preferPersonGivenName(current, majority.name, params.emails);
  }
  if (isGivenNameInitialExpansion(current, majority.name)) {
    return preferPersonGivenName(current, majority.name, params.emails);
  }

  const currentKey = titleCaseGivenName(current);
  const currentCount = params.votes.get(currentKey) ?? 0;
  if (majority.count < Math.max(currentCount * 2, currentCount + 2)) {
    return current;
  }
  return (
    sanitizeGivenNameAgainstEmails(majority.name, params.emails) ?? current
  );
}

/**
 * Restore missing / local-part first names from fingerprint + third-pass cards
 * (and dotted local-parts like shawna.greenspan when last name matches).
 */
export async function recoverMissingFirstNamesFromEvidence(): Promise<{
  recovered: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      nameAliasesJson: contactPersons.nameAliasesJson,
    })
    .from(contactPersons);
  if (persons.length === 0) return { recovered: 0 };

  const emailRows = await db
    .select({
      personId: contactPersonEmails.personId,
      email: contactPersonEmails.email,
    })
    .from(contactPersonEmails);
  const emailsByPerson = new Map<string, string[]>();
  for (const row of emailRows) {
    const list = emailsByPerson.get(row.personId) ?? [];
    list.push(row.email);
    emailsByPerson.set(row.personId, list);
  }

  const candidates = persons.filter((person) => {
    const emails = emailsByPerson.get(person.id) ?? [];
    if (emails.length === 0) return false;
    const first = person.firstName?.trim() || null;
    if (!first) return true;
    return isNameMatchingEmailLocalPart(first, emails);
  });
  if (candidates.length === 0) return { recovered: 0 };

  const candidateEmails = [
    ...new Set(candidates.flatMap((p) => emailsByPerson.get(p.id) ?? [])),
  ];
  const patterns = candidateEmails.map((email) => `%${email}%`);

  const votes: GivenNameVoteBucket = new Map();

  // Chunk OR ILIKE filters to keep query size reasonable.
  const chunkSize = 25;
  for (let i = 0; i < patterns.length; i += chunkSize) {
    const chunk = patterns.slice(i, i + chunkSize);
    const fpMatch = or(
      ...chunk.map(
        (p) => sql`${contactFingerprintMerges.entityCardsJson} ILIKE ${p}`,
      ),
    );
    const fpRows = fpMatch
      ? await db
          .select({ entityCardsJson: contactFingerprintMerges.entityCardsJson })
          .from(contactFingerprintMerges)
          .where(fpMatch)
      : [];
    for (const row of fpRows) {
      for (const card of parseEntityCardsJson(row.entityCardsJson)) {
        tallyGivenNameVote(
          votes,
          card.email,
          card.first_name,
          card.last_name,
        );
      }
    }

    const thirdMatch = or(
      ...chunk.map(
        (p) =>
          sql`${contactHighlightExtractions.thirdPassExtractionJson} ILIKE ${p}`,
      ),
    );
    const thirdRows = thirdMatch
      ? await db
          .select({
            thirdPassExtractionJson:
              contactHighlightExtractions.thirdPassExtractionJson,
          })
          .from(contactHighlightExtractions)
          .where(thirdMatch)
      : [];
    for (const row of thirdRows) {
      for (const card of parseEntityCardsJson(row.thirdPassExtractionJson)) {
        tallyGivenNameVote(
          votes,
          card.email,
          card.first_name,
          card.last_name,
        );
      }
    }
  }

  let recovered = 0;
  for (const person of candidates) {
    const emails = emailsByPerson.get(person.id) ?? [];
    const combined = new Map<string, number>();
    const scopeLast = person.lastName?.trim() || null;
    for (const email of emails) {
      const key = normalizeContactRegistryEmail(email);
      const byName = votes.get(key);
      if (!byName) continue;
      for (const [name, entry] of byName) {
        if (
          scopeLast &&
          entry.lastName &&
          !lastNamesCompatible(scopeLast, entry.lastName)
        ) {
          continue;
        }
        combined.set(name, (combined.get(name) ?? 0) + entry.count);
      }
    }

    let bestName: string | null = null;
    let bestCount = 0;
    for (const [name, count] of combined) {
      if (count > bestCount) {
        bestName = name;
        bestCount = count;
      }
    }

    // Require at least 2 evidence hits, else try dotted local-part fallback.
    if (!bestName || bestCount < 2) {
      let dotted: string | null = null;
      for (const email of emails) {
        dotted = guessFirstNameFromDottedLocalPart(email, person.lastName);
        if (dotted) break;
      }
      if (!dotted) continue;
      bestName = dotted;
    }

    const sanitized = sanitizeGivenNameAgainstEmails(bestName, emails);
    if (!sanitized) continue;
    if (
      sanitized.toLowerCase() === (person.firstName?.trim().toLowerCase() ?? "")
    ) {
      continue;
    }

    const aliases = finalizeNameAliases({
      kept: sanitized,
      lists: [
        parseNameAliasesJson(person.nameAliasesJson),
        collectDiscardedNameAliases({
          kept: sanitized,
          candidates: [
            person.firstName,
            ...[...combined.keys()].filter((n) => n !== sanitized),
          ],
          emails,
        }),
      ],
    });

    await db
      .update(contactPersons)
      .set({
        firstName: sanitized,
        nameAliasesJson: serializeNameAliasesJson(aliases),
        updatedAt: nowIso,
      })
      .where(eq(contactPersons.id, person.id));
    recovered += 1;
  }

  return { recovered };
}

/**
 * When fingerprint / third-pass evidence strongly prefers a different given name
 * than the one stored (and they are not spelling variants), correct the primary
 * name. Prevents length-based flips like Paul → Peter from sticking once a
 * minority of bad cards arrives.
 */
export async function correctConflictingFirstNamesFromEvidence(): Promise<{
  corrected: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      nameAliasesJson: contactPersons.nameAliasesJson,
    })
    .from(contactPersons);
  if (persons.length === 0) return { corrected: 0 };

  const emailRows = await db
    .select({
      personId: contactPersonEmails.personId,
      email: contactPersonEmails.email,
    })
    .from(contactPersonEmails);
  const emailsByPerson = new Map<string, string[]>();
  for (const row of emailRows) {
    const list = emailsByPerson.get(row.personId) ?? [];
    list.push(row.email);
    emailsByPerson.set(row.personId, list);
  }

  const candidates = persons.filter((person) => {
    const emails = emailsByPerson.get(person.id) ?? [];
    if (emails.length === 0) return false;
    const first = person.firstName?.trim() || null;
    if (!first) return false;
    if (isNameMatchingEmailLocalPart(first, emails)) return false;
    return true;
  });
  if (candidates.length === 0) return { corrected: 0 };

  const candidateEmails = [
    ...new Set(candidates.flatMap((p) => emailsByPerson.get(p.id) ?? [])),
  ];
  const patterns = candidateEmails.map((email) => `%${email}%`);
  const votes: GivenNameVoteBucket = new Map();

  const chunkSize = 25;
  for (let i = 0; i < patterns.length; i += chunkSize) {
    const chunk = patterns.slice(i, i + chunkSize);
    const fpMatch = or(
      ...chunk.map(
        (p) => sql`${contactFingerprintMerges.entityCardsJson} ILIKE ${p}`,
      ),
    );
    const fpRows = fpMatch
      ? await db
          .select({ entityCardsJson: contactFingerprintMerges.entityCardsJson })
          .from(contactFingerprintMerges)
          .where(fpMatch)
      : [];
    for (const row of fpRows) {
      for (const card of parseEntityCardsJson(row.entityCardsJson)) {
        tallyGivenNameVote(
          votes,
          card.email,
          card.first_name,
          card.last_name,
        );
      }
    }

    const thirdMatch = or(
      ...chunk.map(
        (p) =>
          sql`${contactHighlightExtractions.thirdPassExtractionJson} ILIKE ${p}`,
      ),
    );
    const thirdRows = thirdMatch
      ? await db
          .select({
            thirdPassExtractionJson:
              contactHighlightExtractions.thirdPassExtractionJson,
          })
          .from(contactHighlightExtractions)
          .where(thirdMatch)
      : [];
    for (const row of thirdRows) {
      for (const card of parseEntityCardsJson(row.thirdPassExtractionJson)) {
        tallyGivenNameVote(
          votes,
          card.email,
          card.first_name,
          card.last_name,
        );
      }
    }
  }

  let corrected = 0;
  for (const person of candidates) {
    const emails = emailsByPerson.get(person.id) ?? [];
    const combined = new Map<string, number>();
    const scopeLast = person.lastName?.trim() || null;
    for (const email of emails) {
      const key = normalizeContactRegistryEmail(email);
      const byName = votes.get(key);
      if (!byName) continue;
      for (const [name, entry] of byName) {
        if (
          scopeLast &&
          entry.lastName &&
          !lastNamesCompatible(scopeLast, entry.lastName)
        ) {
          continue;
        }
        combined.set(name, (combined.get(name) ?? 0) + entry.count);
      }
    }
    if (combined.size === 0) continue;

    let bestName: string | null = null;
    let bestCount = 0;
    for (const [name, count] of combined) {
      if (count > bestCount) {
        bestName = name;
        bestCount = count;
      }
    }
    if (!bestName || bestCount < 2) continue;

    const current = person.firstName!.trim();
    const currentKey = titleCaseGivenName(current);
    const currentCount = combined.get(currentKey) ?? 0;
    // Require a clear majority over the stored name (2× and at least +2).
    if (bestCount < Math.max(currentCount * 2, currentCount + 2)) {
      // Still prune contaminated aliases when primary stays put.
      const pruned = finalizeNameAliases({
        kept: current,
        lists: [parseNameAliasesJson(person.nameAliasesJson)],
      });
      const prev = parseNameAliasesJson(person.nameAliasesJson);
      if (
        pruned.length !== prev.length ||
        pruned.some((a, i) => a !== prev[i])
      ) {
        await db
          .update(contactPersons)
          .set({
            nameAliasesJson: serializeNameAliasesJson(pruned),
            updatedAt: nowIso,
          })
          .where(eq(contactPersons.id, person.id));
        corrected += 1;
      }
      continue;
    }

    const nextRaw =
      isGivenNameSpellingVariant(current, bestName) ||
      isGivenNameInitialExpansion(current, bestName)
        ? preferPersonGivenName(current, bestName, emails)
        : bestName;
    const sanitized = sanitizeGivenNameAgainstEmails(nextRaw, emails);
    if (!sanitized) continue;

    if (sanitized.toLowerCase() === current.toLowerCase()) {
      const pruned = finalizeNameAliases({
        kept: sanitized,
        lists: [parseNameAliasesJson(person.nameAliasesJson)],
      });
      const prev = parseNameAliasesJson(person.nameAliasesJson);
      if (
        pruned.length === prev.length &&
        pruned.every((a, i) => a === prev[i])
      ) {
        continue;
      }
      await db
        .update(contactPersons)
        .set({
          nameAliasesJson: serializeNameAliasesJson(pruned),
          updatedAt: nowIso,
        })
        .where(eq(contactPersons.id, person.id));
      corrected += 1;
      continue;
    }

    const aliases = finalizeNameAliases({
      kept: sanitized,
      lists: [
        parseNameAliasesJson(person.nameAliasesJson),
        collectDiscardedNameAliases({
          kept: sanitized,
          candidates: [current, ...combined.keys()],
          emails,
        }),
      ],
    });

    await db
      .update(contactPersons)
      .set({
        firstName: sanitized,
        nameAliasesJson: serializeNameAliasesJson(aliases),
        updatedAt: nowIso,
      })
      .where(eq(contactPersons.id, person.id));
    corrected += 1;
  }

  return { corrected };
}

/**
 * Re-finalize name_aliases_json for every person so contaminated Also-known-as
 * rows (shared-mailbox greetings, bare initials, unrelated people) are dropped
 * even when first_name does not change.
 */
export async function pruneContaminatedNameAliases(): Promise<{
  pruned: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      nameAliasesJson: contactPersons.nameAliasesJson,
    })
    .from(contactPersons);

  let pruned = 0;
  for (const person of persons) {
    const prev = parseNameAliasesJson(person.nameAliasesJson);
    if (prev.length === 0 && !person.nameAliasesJson) continue;
    const next = finalizeNameAliases({
      kept: person.firstName,
      lists: [prev],
    });
    if (
      next.length === prev.length &&
      next.every((a, i) => a === prev[i]) &&
      (next.length > 0 || !person.nameAliasesJson)
    ) {
      continue;
    }
    await db
      .update(contactPersons)
      .set({
        nameAliasesJson: serializeNameAliasesJson(next),
        updatedAt: nowIso,
      })
      .where(eq(contactPersons.id, person.id));
    pruned += 1;
  }
  return { pruned };
}

/**
 * Clear first_name when it is exactly an email local-part on that person.
 * Local-parts are not stored as aliases (noise). Runs on Entities page coalesce.
 */
export async function repairEmailLocalPartFirstNames(): Promise<{
  repaired: number;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
    })
    .from(contactPersons);
  if (persons.length === 0) return { repaired: 0 };

  const personIds = persons.map((p) => p.id);
  const emailRows = await db
    .select({
      personId: contactPersonEmails.personId,
      email: contactPersonEmails.email,
    })
    .from(contactPersonEmails)
    .where(inArray(contactPersonEmails.personId, personIds));
  const emailsByPerson = new Map<string, string[]>();
  for (const row of emailRows) {
    const list = emailsByPerson.get(row.personId) ?? [];
    list.push(row.email);
    emailsByPerson.set(row.personId, list);
  }

  let repaired = 0;
  for (const person of persons) {
    const emails = emailsByPerson.get(person.id) ?? [];
    if (emails.length === 0) continue;
    const sanitized = sanitizeGivenNameAgainstEmails(person.firstName, emails);
    if (sanitized === (person.firstName?.trim() || null)) continue;
    await db
      .update(contactPersons)
      .set({
        firstName: sanitized,
        updatedAt: nowIso,
      })
      .where(eq(contactPersons.id, person.id));
    repaired += 1;
  }
  return { repaired };
}

/**
 * Absorb weak-name / last-only / same-name duplicate people that share a
 * mailbox into the strongest matching identity — clustered per human, not
 * mailbox-wide. Otherwise `studiopm@` would pick Bonnie and leave every
 * "Haider" / "Haider M" stub unmerged.
 */
export async function coalesceWeakEmailDuplicatePersons(): Promise<{
  merged: number;
  emailsTouched: number;
  firstNamesRepaired: number;
  firstNamesRecovered: number;
  firstNamesCorrected: number;
  aliasesPruned: number;
  occupancyRowsUpdated: number;
}> {
  // Recover real given names before stripping leftover local-parts.
  const recovered = await recoverMissingFirstNamesFromEvidence();
  const repair = await repairEmailLocalPartFirstNames();
  // Majority evidence can override a stuck wrong given name (Paul vs Peter).
  const corrected = await correctConflictingFirstNamesFromEvidence();
  // Drop contaminated Also-known-as rows even when the primary name is fine.
  const aliasPrune = await pruneContaminatedNameAliases();

  const db = getDb();
  const nowIso = new Date().toISOString();
  const emailRows = await db.select().from(contactPersonEmails);
  const byEmail = new Map<string, Set<string>>();
  for (const row of emailRows) {
    const key = normalizeContactRegistryEmail(row.email);
    const set = byEmail.get(key) ?? new Set<string>();
    set.add(row.personId);
    byEmail.set(key, set);
  }

  let merged = 0;
  const touchedEmails: string[] = [];

  for (const [email, personIdSet] of byEmail) {
    if (personIdSet.size < 2) continue;
    const personIds = [...personIdSet];
    const persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        mentionWeight: contactPersons.mentionWeight,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));
    if (persons.length < 2) continue;

    const plans = planMailboxIdentityMerges(persons);
    let didMerge = false;
    for (const plan of plans) {
      for (const person of plan.absorbed) {
        await mergePersons({
          survivorId: plan.survivor.id,
          absorbedId: person.id,
          nowIso,
        });
        merged += 1;
        didMerge = true;
      }
    }
    if (didMerge) touchedEmails.push(email);
  }

  if (touchedEmails.length > 0) {
    await refreshEmailIndex(touchedEmails, nowIso);
  }

  const occupancy = await repairSharedMailboxOccupancy();

  return {
    merged,
    emailsTouched: touchedEmails.length,
    firstNamesRepaired: repair.repaired,
    firstNamesRecovered: recovered.recovered,
    firstNamesCorrected: corrected.corrected,
    aliasesPruned: aliasPrune.pruned,
    occupancyRowsUpdated: occupancy.rowsUpdated,
  };
}

/**
 * Manual UI merge: absorb each source into `targetPersonId` (target survives).
 */
export async function manualMergeManyPersons(params: {
  sourcePersonIds: string[];
  targetPersonId: string;
}): Promise<
  | { ok: true; survivorId: string; merged: number }
  | { ok: false; error: string }
> {
  const targetId = params.targetPersonId.trim();
  if (!targetId) {
    return { ok: false, error: "Target person id is required." };
  }

  const sourceIds = [
    ...new Set(
      params.sourcePersonIds
        .map((id) => id.trim())
        .filter((id) => id && id !== targetId),
    ),
  ];
  if (sourceIds.length === 0) {
    const hadOnlyTarget = params.sourcePersonIds.some(
      (id) => id.trim() === targetId,
    );
    if (hadOnlyTarget && params.sourcePersonIds.length > 0) {
      return { ok: false, error: "Cannot merge a person into themselves." };
    }
    return { ok: false, error: "At least one source person is required." };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  const [target, ...sources] = await Promise.all([
    db
      .select({ id: contactPersons.id })
      .from(contactPersons)
      .where(eq(contactPersons.id, targetId))
      .limit(1)
      .then((r) => r[0]),
    ...sourceIds.map((sourceId) =>
      db
        .select({ id: contactPersons.id })
        .from(contactPersons)
        .where(eq(contactPersons.id, sourceId))
        .limit(1)
        .then((r) => r[0]),
    ),
  ]);
  if (!target) return { ok: false, error: "Target person not found." };
  const missingIndex = sourceIds.findIndex((_, index) => !sources[index]);
  if (missingIndex >= 0) {
    return {
      ok: false,
      error: `Source person not found: ${sourceIds[missingIndex]}.`,
    };
  }

  const emailRows = await db
    .select({ email: contactPersonEmails.email })
    .from(contactPersonEmails)
    .where(
      inArray(contactPersonEmails.personId, [...sourceIds, targetId]),
    );

  let merged = 0;
  for (const sourceId of sourceIds) {
    await mergePersons({
      survivorId: targetId,
      absorbedId: sourceId,
      nowIso,
    });
    merged += 1;
  }

  await refreshEmailIndex(
    emailRows.map((row) => row.email),
    nowIso,
  );

  return { ok: true, survivorId: targetId, merged };
}

/**
 * Manual UI merge: absorb `sourcePersonId` into `targetPersonId` (target survives).
 * Refreshes the email index for every address either person held.
 */
export async function manualMergePersons(params: {
  sourcePersonId: string;
  targetPersonId: string;
}): Promise<{ ok: true; survivorId: string } | { ok: false; error: string }> {
  const result = await manualMergeManyPersons({
    sourcePersonIds: [params.sourcePersonId],
    targetPersonId: params.targetPersonId,
  });
  if (!result.ok) return result;
  return { ok: true, survivorId: result.survivorId };
}

export async function attachManualContactField(params: {
  personId: string;
  field: "email" | "phone" | "name_alias";
  value: string;
}): Promise<
  | {
      ok: true;
      attached: boolean;
      alreadyIdentity: boolean;
      displayName: string;
    }
  | { ok: false; error: string }
> {
  const personId = params.personId.trim();
  const value = params.value.trim();
  if (!personId) return { ok: false, error: "personId is required." };
  if (!value) return { ok: false, error: "Cannot attach an empty value." };

  const db = getDb();
  const nowIso = new Date().toISOString();
  const person = (
    await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        nameAliasesJson: contactPersons.nameAliasesJson,
      })
      .from(contactPersons)
      .where(eq(contactPersons.id, personId))
      .limit(1)
  )[0];
  if (!person) return { ok: false, error: "Person not found." };
  const displayName = personDisplayName(person);

  if (params.field === "email") {
    await appendEmailOccupancy({
      personId,
      email: value,
      validFrom: null,
      validTo: null,
      evidence: [],
      nowIso,
    });
    return { ok: true, attached: true, alreadyIdentity: false, displayName };
  }

  if (params.field === "phone") {
    await appendPhone({
      personId,
      phone: value,
      validFrom: null,
      validTo: null,
      evidence: [],
      nowIso,
    });
    return { ok: true, attached: true, alreadyIdentity: false, displayName };
  }

  const token = normalizeGivenNameToken(value);
  const firstToken = normalizeGivenNameToken(person.firstName ?? "");
  const lastToken = normalizeGivenNameToken(person.lastName ?? "");
  if (token && (token === firstToken || token === lastToken)) {
    return { ok: true, attached: false, alreadyIdentity: true, displayName };
  }

  const next = mergeNameAliasLists(
    parseNameAliasesJson(person.nameAliasesJson),
    [value],
  );
  await db
    .update(contactPersons)
    .set({
      nameAliasesJson: serializeNameAliasesJson(next),
      updatedAt: nowIso,
    })
    .where(eq(contactPersons.id, personId));
  return { ok: true, attached: true, alreadyIdentity: false, displayName };
}

export { mergePersons, refreshEmailIndex };
