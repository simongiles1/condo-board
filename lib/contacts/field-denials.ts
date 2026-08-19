/** Persist and apply person metadata negative associations (severed field links). */

import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { contactPersonFieldDenials } from "@/lib/db/schema";
import { normalizeGivenNameToken } from "@/lib/contacts/person-name";
import { normalizeContactRegistryEmail } from "@/lib/contacts/registry-shared";

export const CONTACT_DENIABLE_FIELDS = [
  "email",
  "phone",
  "title",
  "name_alias",
] as const;

export type ContactDeniableField = (typeof CONTACT_DENIABLE_FIELDS)[number];

export type ContactFieldDenial = {
  id: string;
  personId: string;
  field: ContactDeniableField;
  deniedValue: string;
  createdAt: string;
};

export function isContactDeniableField(
  value: string,
): value is ContactDeniableField {
  return (CONTACT_DENIABLE_FIELDS as readonly string[]).includes(value);
}

export function normalizeContactDeniedValue(
  field: ContactDeniableField,
  value: string,
): string {
  const trimmed = value.trim();
  if (field === "email") {
    return normalizeContactRegistryEmail(trimmed);
  }
  if (field === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    return digits || trimmed.toLowerCase();
  }
  if (field === "name_alias") {
    return normalizeGivenNameToken(trimmed);
  }
  return trimmed.toLowerCase();
}

export async function loadContactFieldDenialsForPersons(
  personIds: string[],
): Promise<Map<string, ContactFieldDenial[]>> {
  const out = new Map<string, ContactFieldDenial[]>();
  if (personIds.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select()
    .from(contactPersonFieldDenials)
    .where(inArray(contactPersonFieldDenials.personId, personIds));

  for (const row of rows) {
    if (!isContactDeniableField(row.field)) continue;
    const list = out.get(row.personId) ?? [];
    list.push({
      id: row.id,
      personId: row.personId,
      field: row.field,
      deniedValue: row.deniedValue,
      createdAt: row.createdAt,
    });
    out.set(row.personId, list);
  }
  return out;
}

export function contactFieldValueIsDenied(
  denials: ContactFieldDenial[],
  field: ContactDeniableField,
  rawValue: string,
): boolean {
  const deniedValue = normalizeContactDeniedValue(field, rawValue);
  if (!deniedValue) return false;
  return denials.some(
    (denial) =>
      denial.field === field && denial.deniedValue === deniedValue,
  );
}

export async function recordContactFieldDenial(params: {
  personId: string;
  field: string;
  value: string;
}): Promise<
  { ok: true; denial: ContactFieldDenial } | { ok: false; error: string }
> {
  const personId = params.personId.trim();
  const rawValue = params.value.trim();
  if (!personId) {
    return { ok: false, error: "personId is required." };
  }
  if (!isContactDeniableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${CONTACT_DENIABLE_FIELDS.join(", ")}.`,
    };
  }
  if (!rawValue) {
    return { ok: false, error: "Cannot sever an empty value." };
  }

  const field = params.field;
  const deniedValue = normalizeContactDeniedValue(field, rawValue);
  const db = getDb();
  const existing = await db
    .select({ id: contactPersonFieldDenials.id })
    .from(contactPersonFieldDenials)
    .where(
      and(
        eq(contactPersonFieldDenials.personId, personId),
        eq(contactPersonFieldDenials.field, field),
        eq(contactPersonFieldDenials.deniedValue, deniedValue),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  if (existing[0]) {
    return {
      ok: true,
      denial: {
        id: existing[0].id,
        personId,
        field,
        deniedValue,
        createdAt: nowIso,
      },
    };
  }

  const id = randomUUID();
  await db.insert(contactPersonFieldDenials).values({
    id,
    personId,
    field,
    deniedValue,
    createdAt: nowIso,
  });

  return {
    ok: true,
    denial: { id, personId, field, deniedValue, createdAt: nowIso },
  };
}

export async function deleteContactFieldDenial(params: {
  personId: string;
  field: ContactDeniableField;
  value: string;
}): Promise<void> {
  const personId = params.personId.trim();
  const deniedValue = normalizeContactDeniedValue(params.field, params.value);
  if (!personId || !deniedValue) return;
  const db = getDb();
  await db
    .delete(contactPersonFieldDenials)
    .where(
      and(
        eq(contactPersonFieldDenials.personId, personId),
        eq(contactPersonFieldDenials.field, params.field),
        eq(contactPersonFieldDenials.deniedValue, deniedValue),
      ),
    );
}
