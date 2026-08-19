/** Load contact registry persons for shortlist / UI. */

import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { skipLiveMentionCounts } from "@/lib/background-workers";
import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactFingerprintMerges,
  contactMentions,
  contactMergeProposals,
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
  contactRegistryIngests,
  emails,
  organizationEntities,
} from "@/lib/db/schema";
import {
  entityCardDisplayName,
  type ContactEntityCard,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  countVerifiedPersonMentionEmailsByPersonId,
} from "@/lib/contacts/registry-evidence";
import {
  contactFieldValueIsDenied,
  loadContactFieldDenialsForPersons,
} from "@/lib/contacts/field-denials";
import {
  buildContactDuplicateGroups,
  type ContactDuplicateGroup,
} from "@/lib/contacts/duplicate-groups";
import {
  parseNameAliasesJson,
  personDisplayName,
  type ContactMergeAction,
  type ContactPersonListSort,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
import {
  buildSharedMailboxes,
  sharedMailboxStats,
  type SharedMailboxPersonInfo,
  type SharedMailboxStats,
  type SharedMailboxSummary,
} from "@/lib/contacts/shared-mailboxes";

function orderByForPersonList(params?: {
  orderByMention?: boolean;
  sort?: ContactPersonListSort;
}) {
  const sort =
    params?.sort ??
    (params?.orderByMention === false ? null : "mentions-desc");

  if (sort === null) {
    return [desc(contactPersons.updatedAt), asc(contactPersons.id)] as const;
  }

  const displayNameSql = sql`lower(trim(coalesce(${contactPersons.firstName}, '') || ' ' || coalesce(${contactPersons.lastName}, '')))`;

  switch (sort) {
    case "mentions-asc":
      return [asc(contactPersons.mentionWeight), asc(contactPersons.id)] as const;
    case "name-asc":
      return [asc(displayNameSql), asc(contactPersons.id)] as const;
    case "name-desc":
      return [desc(displayNameSql), asc(contactPersons.id)] as const;
    case "mentions-desc":
    default:
      return [desc(contactPersons.mentionWeight), asc(contactPersons.id)] as const;
  }
}

export async function loadContactRegistryPersons(params?: {
  limit?: number;
  offset?: number;
  orderByMention?: boolean;
  sort?: ContactPersonListSort;
  /** Skip verified mention recount (use stored mentionWeight). */
  skipVerifiedMentions?: boolean;
}): Promise<ContactRegistryPersonSummary[]> {
  const db = getDb();
  const limit = params?.limit ?? 5000;
  const offset = Math.max(0, params?.offset ?? 0);
  const sort =
    params?.sort ??
    (params?.orderByMention === false ? undefined : "mentions-desc");
  const rows = await db
    .select()
    .from(contactPersons)
    .orderBy(...orderByForPersonList({ orderByMention: params?.orderByMention, sort }))
    .limit(limit)
    .offset(offset);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const orgIds = [
    ...new Set(
      rows
        .map((r) => r.currentOrganizationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [emailAttrs, phoneAttrs, titleAttrs, orgRows] = await Promise.all([
    db
      .select()
      .from(contactPersonEmails)
      .where(inArray(contactPersonEmails.personId, ids)),
    db
      .select()
      .from(contactPersonPhones)
      .where(inArray(contactPersonPhones.personId, ids)),
    db
      .select()
      .from(contactPersonTitles)
      .where(inArray(contactPersonTitles.personId, ids)),
    orgIds.length === 0
      ? Promise.resolve(
          [] as Array<{ id: string; name: string | null }>,
        )
      : db
          .select({
            id: organizationEntities.id,
            name: organizationEntities.name,
          })
          .from(organizationEntities)
          .where(inArray(organizationEntities.id, orgIds)),
  ]);

  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));
  const emailsBy = new Map<string, typeof emailAttrs>();
  for (const row of emailAttrs) {
    const list = emailsBy.get(row.personId) ?? [];
    list.push(row);
    emailsBy.set(row.personId, list);
  }
  const phonesBy = new Map<string, typeof phoneAttrs>();
  for (const row of phoneAttrs) {
    const list = phonesBy.get(row.personId) ?? [];
    list.push(row);
    phonesBy.set(row.personId, list);
  }
  const titlesBy = new Map<string, typeof titleAttrs>();
  for (const row of titleAttrs) {
    const list = titlesBy.get(row.personId) ?? [];
    list.push(row);
    titlesBy.set(row.personId, list);
  }

  // UI "mentions" = name in unique authored text (content only).
  // Header participation is available in the evidence panel via scope=all.
  const verifiedMentionCounts =
    params?.skipVerifiedMentions || skipLiveMentionCounts()
      ? new Map<string, number>()
      : await countVerifiedPersonMentionEmailsByPersonId(
          rows.map((row) => ({
            id: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
          })),
        );

  const denialsByPerson = await loadContactFieldDenialsForPersons(ids);

  const summaries: ContactRegistryPersonSummary[] = rows.map((row) => {
    const denials = denialsByPerson.get(row.id) ?? [];
    return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nameAliases: parseNameAliasesJson(row.nameAliasesJson).filter(
      (alias) => !contactFieldValueIsDenied(denials, "name_alias", alias),
    ),
    mentionWeight: row.mentionWeight,
    sourceEmailCount:
      verifiedMentionCounts.get(row.id) ?? row.mentionWeight,
    sparseStub: row.sparseStub,
    currentOrganizationId: row.currentOrganizationId,
    currentOrganizationName: row.currentOrganizationId
      ? (orgNameById.get(row.currentOrganizationId) ?? null)
      : null,
    emails: (emailsBy.get(row.id) ?? [])
      .filter((e) => !contactFieldValueIsDenied(denials, "email", e.email))
      .map((e) => ({
      id: e.id,
      email: e.email,
      validFrom: e.validFrom,
      validTo: e.validTo,
    })),
    phones: (phonesBy.get(row.id) ?? [])
      .filter((p) => !contactFieldValueIsDenied(denials, "phone", p.phone))
      .map((p) => ({
      id: p.id,
      phone: p.phone,
      phoneNormalized: p.phoneNormalized,
      validFrom: p.validFrom,
      validTo: p.validTo,
    })),
    titles: (titlesBy.get(row.id) ?? [])
      .filter((t) => !contactFieldValueIsDenied(denials, "title", t.title))
      .map((t) => ({
      id: t.id,
      title: t.title,
      validFrom: t.validFrom,
      validTo: t.validTo,
    })),
  };
  });

  // Within the page, prefer verified mention counts over raw weight for
  // mention sorts (stable across pages via DB mentionWeight + offset).
  const mentionSort =
    sort === "mentions-desc" ||
    sort === "mentions-asc" ||
    (sort === undefined && params?.orderByMention !== false);
  if (mentionSort) {
    const dir = sort === "mentions-asc" ? 1 : -1;
    summaries.sort(
      (a, b) =>
        dir * (a.sourceEmailCount - b.sourceEmailCount) ||
        dir * (a.mentionWeight - b.mentionWeight) ||
        personDisplayName(a).localeCompare(personDisplayName(b), undefined, {
          sensitivity: "base",
        }),
    );
  }

  return summaries;
}

export async function loadContactRegistryPersonById(
  personId: string,
): Promise<ContactRegistryPersonSummary | null> {
  const all = await loadContactRegistryPersons({ limit: 10000 });
  return all.find((p) => p.id === personId) ?? null;
}

/** Full-registry duplicate clusters for the Contacts → Duplicates tab. */
export async function loadContactDuplicateGroups(): Promise<
  ContactDuplicateGroup[]
> {
  const persons = await loadContactRegistryPersons({
    limit: 10000,
    orderByMention: false,
    skipVerifiedMentions: true,
  });
  return buildContactDuplicateGroups(persons);
}

export type ContactEmailIndexRow = {
  email: string;
  currentPersonId: string | null;
  currentPersonName: string | null;
  updatedAt: string;
  occupants: Array<{
    personId: string;
    personName: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
};

export async function loadContactEmailIndex(
  limit: number = 500,
): Promise<ContactEmailIndexRow[]> {
  const db = getDb();
  const indexRows = await db
    .select()
    .from(contactEmailIndex)
    .orderBy(desc(contactEmailIndex.updatedAt))
    .limit(limit);

  if (indexRows.length === 0) return [];

  const emails = indexRows.map((r) => r.email);
  const occupancy = await db
    .select()
    .from(contactPersonEmails)
    .where(inArray(contactPersonEmails.email, emails));

  const personIds = [
    ...new Set([
      ...indexRows.map((r) => r.currentPersonId).filter(Boolean),
      ...occupancy.map((r) => r.personId),
    ]),
  ] as string[];

  const persons =
    personIds.length > 0
      ? await db
          .select()
          .from(contactPersons)
          .where(inArray(contactPersons.id, personIds))
      : [];
  const personById = new Map(persons.map((p) => [p.id, p]));

  const occByEmail = new Map<string, typeof occupancy>();
  for (const row of occupancy) {
    const list = occByEmail.get(row.email) ?? [];
    list.push(row);
    occByEmail.set(row.email, list);
  }

  return indexRows.map((row) => {
    const current = row.currentPersonId
      ? personById.get(row.currentPersonId)
      : null;
    return {
      email: row.email,
      currentPersonId: row.currentPersonId,
      currentPersonName: current
        ? personDisplayName({
            firstName: current.firstName,
            lastName: current.lastName,
            emails: [{ email: row.email }],
          })
        : null,
      updatedAt: row.updatedAt,
      occupants: (occByEmail.get(row.email) ?? []).map((o) => {
        const p = personById.get(o.personId);
        return {
          personId: o.personId,
          personName: p
            ? personDisplayName({
                firstName: p.firstName,
                lastName: p.lastName,
              })
            : o.personId.slice(0, 8),
          validFrom: o.validFrom,
          validTo: o.validTo,
        };
      }),
    };
  });
}

/** Addresses with two or more occupancy people, plus date ranges. */
export async function loadSharedMailboxes(): Promise<{
  mailboxes: SharedMailboxSummary[];
  stats: SharedMailboxStats;
}> {
  const db = getDb();
  const occupancy = await db.select().from(contactPersonEmails);
  if (occupancy.length === 0) {
    return { mailboxes: [], stats: { mailboxCount: 0, occupantCount: 0 } };
  }

  const personIds = [...new Set(occupancy.map((row) => row.personId))];
  const personRows = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      sparseStub: contactPersons.sparseStub,
      mentionWeight: contactPersons.mentionWeight,
      currentOrganizationId: contactPersons.currentOrganizationId,
    })
    .from(contactPersons)
    .where(inArray(contactPersons.id, personIds));

  const orgIds = [
    ...new Set(
      personRows
        .map((row) => row.currentOrganizationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const orgRows =
    orgIds.length === 0
      ? []
      : await db
          .select({
            id: organizationEntities.id,
            name: organizationEntities.name,
          })
          .from(organizationEntities)
          .where(inArray(organizationEntities.id, orgIds));
  const orgNameById = new Map(orgRows.map((row) => [row.id, row.name]));

  const persons = new Map<string, SharedMailboxPersonInfo>();
  for (const row of personRows) {
    persons.set(row.id, {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      sparseStub: row.sparseStub,
      mentionWeight: row.mentionWeight,
      currentOrganizationName: row.currentOrganizationId
        ? (orgNameById.get(row.currentOrganizationId) ?? null)
        : null,
    });
  }

  const mailboxes = buildSharedMailboxes(occupancy, persons);
  return { mailboxes, stats: sharedMailboxStats(mailboxes) };
}

export async function getRegistryStats(): Promise<{
  personCount: number;
  emailCount: number;
  sparseStubCount: number;
  /** Pass-4 merges not yet successfully ingested into the registry. */
  pendingMergeCount: number;
  mergeDecisionCount: number;
  ingestCompletedCount: number;
  mentionTotalCount: number;
  mentionConfirmedCount: number;
  mentionProvisionalCount: number;
  mentionUnresolvedCount: number;
}> {
  const db = getDb();
  const persons = await db
    .select({ id: contactPersons.id, sparseStub: contactPersons.sparseStub })
    .from(contactPersons);
  const emails = await db
    .select({ email: contactEmailIndex.email })
    .from(contactEmailIndex);

  const completedIngests = await db
    .select({
      fingerprintMergeId: contactRegistryIngests.fingerprintMergeId,
    })
    .from(contactRegistryIngests)
    .where(eq(contactRegistryIngests.status, "completed"));
  const done = new Set(completedIngests.map((r) => r.fingerprintMergeId));

  const merges = await db
    .select({
      id: contactFingerprintMerges.id,
      error: contactFingerprintMerges.error,
    })
    .from(contactFingerprintMerges);
  const pendingMergeCount = merges.filter(
    (m) => !m.error && !done.has(m.id),
  ).length;

  const proposals = await db
    .select({ id: contactMergeProposals.id })
    .from(contactMergeProposals);
  const mentionRows = await db
    .select({
      status: contactMentions.resolutionStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(contactMentions)
    .groupBy(contactMentions.resolutionStatus);
  const mentionCounts = {
    total: 0,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
  };
  for (const row of mentionRows) {
    const count = Number(row.count) || 0;
    mentionCounts.total += count;
    if (row.status === "confirmed") mentionCounts.confirmed = count;
    else if (row.status === "provisional") mentionCounts.provisional = count;
    else if (row.status === "unresolved") mentionCounts.unresolved = count;
  }

  return {
    personCount: persons.length,
    emailCount: emails.length,
    sparseStubCount: persons.filter((p) => p.sparseStub).length,
    pendingMergeCount,
    mergeDecisionCount: proposals.length,
    ingestCompletedCount: completedIngests.length,
    mentionTotalCount: mentionCounts.total,
    mentionConfirmedCount: mentionCounts.confirmed,
    mentionProvisionalCount: mentionCounts.provisional,
    mentionUnresolvedCount: mentionCounts.unresolved,
  };
}

export type ContactMergeActivityRow = {
  id: string;
  action: ContactMergeAction;
  incomingLabel: string;
  incomingCard: ContactEntityCard;
  targetPersonId: string | null;
  resultPersonId: string | null;
  resultPersonName: string | null;
  reason: string | null;
  modelId: string | null;
  createdAt: string;
};

export async function loadContactMergeActivity(
  limit: number = 100,
): Promise<ContactMergeActivityRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(contactMergeProposals)
    .orderBy(desc(contactMergeProposals.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const personIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.targetPersonId, r.resultPersonId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const persons =
    personIds.length > 0
      ? await db
          .select()
          .from(contactPersons)
          .where(inArray(contactPersons.id, personIds))
      : [];
  const personById = new Map(persons.map((p) => [p.id, p]));

  return rows.map((row) => {
    let incomingCard: ContactEntityCard = {
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      job_title: null,
    };
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(row.incomingCardJson) as ContactEntityCard;
      incomingCard = {
        first_name: parsed.first_name ?? null,
        last_name: parsed.last_name ?? null,
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        job_title: parsed.job_title ?? null,
      };
    } catch {
      // keep empty
    }
    try {
      const decision = JSON.parse(row.decisionJson) as { reason?: string };
      reason = decision.reason ?? null;
    } catch {
      reason = null;
    }
    const result = row.resultPersonId
      ? personById.get(row.resultPersonId)
      : null;
    return {
      id: row.id,
      action: row.action as ContactMergeAction,
      incomingLabel: entityCardDisplayName(incomingCard),
      incomingCard,
      targetPersonId: row.targetPersonId,
      resultPersonId: row.resultPersonId,
      resultPersonName: result
        ? personDisplayName({
            firstName: result.firstName,
            lastName: result.lastName,
          })
        : null,
      reason,
      modelId: row.modelId,
      createdAt: row.createdAt,
    };
  });
}
