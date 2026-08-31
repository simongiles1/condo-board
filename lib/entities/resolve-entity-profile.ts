/** Server-only harvest fingerprint → registry id resolve. */

import { eq, ilike } from "drizzle-orm";

import { lastNamesCompatible } from "@/lib/contacts/person-name";
import { normalizeContactRegistryEmail } from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactPersonEmails,
  contactPersonPhones,
  contactPersons,
  organizationEntities,
  projectEntities,
} from "@/lib/db/schema";
import { normalizePhone } from "@/lib/email/entity-dedup";
import {
  pickUniqueOrgId,
  pickUniquePersonId,
  pickUniqueProjectId,
  type PersonResolveCandidate,
} from "@/lib/entities/entity-profile-resolve";
import type {
  EntityProfileResolveHint,
  EntityProfileResolveResult,
} from "@/lib/entities/entity-profile-shared";
import { parseProjectAliasesJson } from "@/lib/projects/project-multi-values";

async function resolvePersonId(
  hint: EntityProfileResolveHint,
): Promise<string | null> {
  const db = getDb();
  const emailKey = hint.email?.trim()
    ? normalizeContactRegistryEmail(hint.email)
    : "";
  if (emailKey) {
    const [indexRow] = await db
      .select({ currentPersonId: contactEmailIndex.currentPersonId })
      .from(contactEmailIndex)
      .where(eq(contactEmailIndex.email, emailKey))
      .limit(1);
    if (indexRow?.currentPersonId) return indexRow.currentPersonId;

    const occupancies = await db
      .select({ personId: contactPersonEmails.personId })
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.email, emailKey));
    return pickUniquePersonId(
      occupancies.map((row) => ({
        id: row.personId,
        sparseStub: false,
        firstName: null,
        lastName: null,
        emails: [emailKey],
        phonesNormalized: [],
      })),
      { email: emailKey },
    );
  }

  const phoneKey = hint.phone?.trim() ? normalizePhone(hint.phone) : "";
  if (phoneKey.length >= 7) {
    const occupancies = await db
      .select({ personId: contactPersonPhones.personId })
      .from(contactPersonPhones)
      .where(eq(contactPersonPhones.phoneNormalized, phoneKey));
    return pickUniquePersonId(
      occupancies.map((row) => ({
        id: row.personId,
        sparseStub: false,
        firstName: null,
        lastName: null,
        emails: [],
        phonesNormalized: [phoneKey],
      })),
      { phone: hint.phone },
    );
  }

  const first = hint.firstName?.trim() ?? "";
  const last = hint.lastName?.trim() ?? "";
  if (!first || !last) return null;

  const lastNeedle = last.toLowerCase().replace(/%/g, "");
  const rows = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      sparseStub: contactPersons.sparseStub,
    })
    .from(contactPersons)
    .where(ilike(contactPersons.lastName, lastNeedle))
    .limit(50);

  const candidates: PersonResolveCandidate[] = rows
    .filter((row) => lastNamesCompatible(row.lastName, last))
    .map((row) => ({
      id: row.id,
      sparseStub: row.sparseStub,
      firstName: row.firstName,
      lastName: row.lastName,
      emails: [],
      phonesNormalized: [],
    }));

  return pickUniquePersonId(candidates, {
    firstName: first,
    lastName: last,
  });
}

async function resolveOrgId(name: string | null | undefined): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: organizationEntities.id,
      name: organizationEntities.name,
    })
    .from(organizationEntities)
    .where(eq(organizationEntities.status, "active"));
  return pickUniqueOrgId(rows, trimmed);
}

async function resolveProjectId(hint: EntityProfileResolveHint): Promise<string | null> {
  const name = hint.name?.trim();
  if (!name) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: projectEntities.id,
      name: projectEntities.name,
      aliasesJson: projectEntities.aliasesJson,
      yearHint: projectEntities.yearHint,
    })
    .from(projectEntities)
    .where(eq(projectEntities.status, "active"));
  return pickUniqueProjectId(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      aliases: parseProjectAliasesJson(row.aliasesJson),
      yearHint: row.yearHint,
    })),
    { name, yearHint: hint.yearHint },
  );
}

export async function resolveEntityProfile(
  hint: EntityProfileResolveHint,
): Promise<EntityProfileResolveResult> {
  const kind = hint.kind;
  if (kind === "person") {
    return { kind, id: await resolvePersonId(hint) };
  }
  if (kind === "organization") {
    return { kind, id: await resolveOrgId(hint.name) };
  }
  if (kind === "project") {
    return { kind, id: await resolveProjectId(hint) };
  }
  return { kind, id: null };
}

export function parseResolveHint(body: unknown): EntityProfileResolveHint | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const kind = obj.kind;
  if (
    kind !== "person" &&
    kind !== "organization" &&
    kind !== "project" &&
    kind !== "equipment" &&
    kind !== "event"
  ) {
    return null;
  }
  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    kind,
    email: asString(obj.email),
    phone: asString(obj.phone),
    firstName: asString(obj.firstName),
    lastName: asString(obj.lastName),
    name: asString(obj.name),
    yearHint: asString(obj.yearHint),
  };
}
