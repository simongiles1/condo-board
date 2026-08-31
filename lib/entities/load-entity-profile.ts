/** Server-only entity profile loader for the Wikipedia click-through panel. */

import { and, eq, isNull } from "drizzle-orm";

import { calendarHref } from "@/lib/calendar/grid";
import {
  CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  loadContactEvidence,
  type ContactEvidenceScope,
} from "@/lib/contacts/registry-evidence";
import { personDisplayName } from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  calendarEvents,
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
  equipmentAssets,
  organizationEntities,
  projectEntities,
} from "@/lib/db/schema";
import {
  emptyProfilePaging,
  entityRegistryHref,
  orgProfilePreviewNeedles,
  profileInitials,
  type EntityProfileKind,
  type EntityProfilePayload,
  type EntityProfilePaging,
} from "@/lib/entities/entity-profile-shared";
import { involveWhenFromJobTitle } from "@/lib/entities/involve-when";
import { loadOrgFingerprintSummaries } from "@/lib/organizations/fingerprint-list";
import { loadOrgMentionEvidence } from "@/lib/organizations/mention-evidence";
import {
  loadOrgFieldEvidence,
  ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
} from "@/lib/organizations/registry-evidence";
import {
  loadProjectFieldEvidence,
  PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
} from "@/lib/projects/registry-evidence";

export type LoadEntityProfileOptions = {
  page?: number;
  scope?: ContactEvidenceScope;
  /** Display name hint when the registry id is a fingerprint identity key. */
  nameHint?: string | null;
};

function pagingFrom(params: {
  page: number;
  pageSize: number;
  totalPages: number;
  matchedCount: number;
}): EntityProfilePaging {
  return {
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, params.totalPages),
    matchedCount: params.matchedCount,
  };
}

function pickCurrent<T extends { validTo: string | null }>(rows: T[]): T | undefined {
  return rows.find((row) => !row.validTo) ?? rows[0];
}

async function loadPersonProfile(
  personId: string,
  options: LoadEntityProfileOptions,
): Promise<EntityProfilePayload | null> {
  const db = getDb();
  const [person] = await db
    .select()
    .from(contactPersons)
    .where(eq(contactPersons.id, personId))
    .limit(1);
  if (!person) return null;

  const [emailRows, phoneRows, titleRows] = await Promise.all([
    db
      .select()
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.personId, personId)),
    db
      .select()
      .from(contactPersonPhones)
      .where(eq(contactPersonPhones.personId, personId)),
    db
      .select()
      .from(contactPersonTitles)
      .where(eq(contactPersonTitles.personId, personId)),
  ]);

  let organizationName: string | null = null;
  if (person.currentOrganizationId) {
    const [org] = await db
      .select({ name: organizationEntities.name })
      .from(organizationEntities)
      .where(eq(organizationEntities.id, person.currentOrganizationId))
      .limit(1);
    organizationName = org?.name?.trim() || null;
  }

  const email = pickCurrent(emailRows)?.email ?? null;
  const phone = pickCurrent(phoneRows)?.phone ?? null;
  const title = pickCurrent(titleRows)?.title ?? null;
  const displayName = personDisplayName({
    firstName: person.firstName,
    lastName: person.lastName,
    emails: emailRows.map((row) => ({ email: row.email })),
  });

  const evidence = await loadContactEvidence({
    kind: "person",
    id: personId,
    scope: options.scope,
    page: options.page,
    pageSize: CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  });

  return {
    kind: "person",
    id: personId,
    linked: true,
    displayName,
    initials: profileInitials(displayName, person.firstName, person.lastName),
    registryHref: entityRegistryHref("person", true),
    firstName: person.firstName,
    lastName: person.lastName,
    title,
    email,
    phone,
    organizationName,
    involveWhen: involveWhenFromJobTitle(title),
    emails: (evidence?.emails ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: row.preview,
    })),
    paging: evidence
      ? pagingFrom(evidence)
      : emptyProfilePaging(),
    scope: evidence?.scope ?? (options.scope === "all" ? "all" : "content"),
    contentCount: evidence?.contentCount ?? 0,
    participationOnlyCount: evidence?.participationOnlyCount ?? 0,
  };
}

async function loadOrgRow(id: string) {
  const db = getDb();
  const [byId] = await db
    .select()
    .from(organizationEntities)
    .where(eq(organizationEntities.id, id))
    .limit(1);
  let row = byId ?? null;
  if (!row) {
    const [byKey] = await db
      .select()
      .from(organizationEntities)
      .where(eq(organizationEntities.identityKey, id))
      .limit(1);
    row = byKey ?? null;
  }
  if (!row) return null;
  if (row.status === "merged" && row.mergedIntoId) {
    const [survivor] = await db
      .select()
      .from(organizationEntities)
      .where(eq(organizationEntities.id, row.mergedIntoId))
      .limit(1);
    return survivor ?? row;
  }
  return row;
}

async function loadOrgFingerprintAliases(
  evidenceId: string,
  rowId?: string | null,
): Promise<string[]> {
  const { organizations } = await loadOrgFingerprintSummaries();
  const summary = organizations.find(
    (org) => org.id === evidenceId || (rowId != null && org.id === rowId),
  );
  return summary?.aliases ?? [];
}

async function loadOrganizationProfile(
  id: string,
  options: LoadEntityProfileOptions,
): Promise<EntityProfilePayload | null> {
  const row = await loadOrgRow(id);
  const name =
    row?.name?.trim() || options.nameHint?.trim() || null;
  const displayName = name || id;
  const evidenceId = row?.identityKey || row?.id || id;

  const fingerprintAliases = await loadOrgFingerprintAliases(evidenceId, row?.id);
  const previewNeedles = orgProfilePreviewNeedles(
    displayName,
    fingerprintAliases,
  );

  const evidence =
    name
      ? await loadOrgMentionEvidence({
          organizationId: evidenceId,
          organizationName: displayName,
          page: options.page,
          pageSize: ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
        })
      : null;

  if (!row && !evidence) return null;

  return {
    kind: "organization",
    id: row?.id ?? id,
    linked: Boolean(row),
    displayName,
    initials: profileInitials(displayName),
    registryHref: entityRegistryHref("organization", true),
    role: row?.organizationRole ?? null,
    email: row?.email ?? null,
    phone: row?.phone ?? null,
    website: row?.website ?? null,
    previewNeedles,
    emails: (evidence?.emails ?? []).map((email) => ({
      id: email.id,
      subject: email.subject,
      fromAddress: email.fromAddress,
      receivedAt: email.receivedAt,
      preview: email.preview,
      highlightNeedles: email.highlightNeedles,
    })),
    paging: evidence ? pagingFrom(evidence) : emptyProfilePaging(),
  };
}

async function loadProjectRow(id: string) {
  const db = getDb();
  const [byId] = await db
    .select()
    .from(projectEntities)
    .where(eq(projectEntities.id, id))
    .limit(1);
  let row = byId ?? null;
  if (!row) {
    const [byKey] = await db
      .select()
      .from(projectEntities)
      .where(eq(projectEntities.identityKey, id))
      .limit(1);
    row = byKey ?? null;
  }
  if (!row) return null;
  if (row.status === "merged" && row.mergedIntoId) {
    const [survivor] = await db
      .select()
      .from(projectEntities)
      .where(eq(projectEntities.id, row.mergedIntoId))
      .limit(1);
    return survivor ?? row;
  }
  return row;
}

async function loadProjectProfile(
  id: string,
  options: LoadEntityProfileOptions,
): Promise<EntityProfilePayload | null> {
  const row = await loadProjectRow(id);
  const displayName =
    row?.name?.trim() || options.nameHint?.trim() || id;
  const evidenceId = row?.identityKey || row?.id || id;

  const evidence = await loadProjectFieldEvidence({
    projectId: evidenceId,
    projectName: displayName,
    field: "source_emails",
    value: displayName,
    page: options.page,
    pageSize: PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
  });

  if (!row && !evidence) return null;

  return {
    kind: "project",
    id: row?.id ?? id,
    linked: Boolean(row),
    displayName,
    initials: profileInitials(displayName),
    registryHref: entityRegistryHref("project", true),
    yearHint: row?.yearHint ?? null,
    phase: row?.phase ?? null,
    contractor: row?.contractor ?? null,
    location: row?.location ?? null,
    equipmentMentions: row?.equipmentMentions ?? null,
    emails: (evidence?.emails ?? []).map((email) => ({
      id: email.id,
      subject: email.subject,
      fromAddress: email.fromAddress,
      receivedAt: email.receivedAt,
      preview: email.preview,
    })),
    paging: evidence ? pagingFrom(evidence) : emptyProfilePaging(),
  };
}

async function loadEquipmentProfile(
  id: string,
): Promise<EntityProfilePayload | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(equipmentAssets)
    .where(and(eq(equipmentAssets.id, id), isNull(equipmentAssets.canonicalId)))
    .limit(1);
  if (!row) return null;
  const displayName = row.name.trim();
  return {
    kind: "equipment",
    id: row.id,
    linked: true,
    displayName,
    initials: profileInitials(displayName),
    registryHref: entityRegistryHref("equipment", true),
    manufacturer: row.manufacturer,
    category: row.category,
    location: row.location,
    equipmentKind: row.kind,
    notes: row.notes,
  };
}

async function loadEventProfile(id: string): Promise<EntityProfilePayload | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .limit(1);
  if (!row) return null;
  const day = row.startAt.slice(0, 10);
  return {
    kind: "event",
    id: row.id,
    linked: true,
    displayName: row.title,
    initials: profileInitials(row.title),
    registryHref: null,
    eventType: row.eventType,
    startAt: row.startAt,
    description: row.description,
    calendarHref: day ? calendarHref("month", day) : null,
  };
}

export async function loadEntityProfile(
  kind: EntityProfileKind,
  id: string,
  options: LoadEntityProfileOptions = {},
): Promise<EntityProfilePayload | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (kind === "person") return loadPersonProfile(trimmed, options);
  if (kind === "organization") return loadOrganizationProfile(trimmed, options);
  if (kind === "project") return loadProjectProfile(trimmed, options);
  if (kind === "equipment") return loadEquipmentProfile(trimmed);
  if (kind === "event") return loadEventProfile(trimmed);
  return null;
}
