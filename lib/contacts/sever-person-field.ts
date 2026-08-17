/** Apply a severed person-field association (UI × on Entities → People). */

import { eq, inArray } from "drizzle-orm";

import {
  type ContactDeniableField,
  normalizeContactDeniedValue,
  recordContactFieldDenial,
} from "@/lib/contacts/field-denials";
import {
  parseNameAliasesJson,
  serializeNameAliasesJson,
} from "@/lib/contacts/person-name";
import {
  normalizeContactRegistryEmail,
  pickCurrentOccupancyPersonId,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
} from "@/lib/db/schema";

async function refreshEmailIndex(
  emails: string[],
  nowIso: string,
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

export async function severContactPersonField(params: {
  personId: string;
  field: ContactDeniableField;
  value: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const denial = await recordContactFieldDenial(params);
  if (!denial.ok) return denial;

  const db = getDb();
  const nowIso = new Date().toISOString();
  const personId = params.personId.trim();
  const deniedValue = normalizeContactDeniedValue(params.field, params.value);

  if (params.field === "email") {
    const rows = await db
      .select()
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.personId, personId));
    const touched: string[] = [];
    for (const row of rows) {
      if (normalizeContactRegistryEmail(row.email) !== deniedValue) continue;
      if (row.validTo == null) {
        await db
          .update(contactPersonEmails)
          .set({ validTo: nowIso, updatedAt: nowIso })
          .where(eq(contactPersonEmails.id, row.id));
      }
      touched.push(row.email);
    }
    if (touched.length > 0) {
      await refreshEmailIndex(touched, nowIso);
    }
  } else if (params.field === "phone") {
    const rows = await db
      .select()
      .from(contactPersonPhones)
      .where(eq(contactPersonPhones.personId, personId));
    for (const row of rows) {
      const digits = row.phoneNormalized || row.phone.replace(/\D/g, "");
      if (digits !== deniedValue && row.phone.trim().toLowerCase() !== deniedValue) {
        continue;
      }
      if (row.validTo == null) {
        await db
          .update(contactPersonPhones)
          .set({ validTo: nowIso, updatedAt: nowIso })
          .where(eq(contactPersonPhones.id, row.id));
      }
    }
  } else if (params.field === "title") {
    const rows = await db
      .select()
      .from(contactPersonTitles)
      .where(eq(contactPersonTitles.personId, personId));
    for (const row of rows) {
      if (row.title.trim().toLowerCase() !== deniedValue) continue;
      if (row.validTo == null) {
        await db
          .update(contactPersonTitles)
          .set({ validTo: nowIso, updatedAt: nowIso })
          .where(eq(contactPersonTitles.id, row.id));
      }
    }
  } else if (params.field === "name_alias") {
    const [person] = await db
      .select({
        id: contactPersons.id,
        nameAliasesJson: contactPersons.nameAliasesJson,
      })
      .from(contactPersons)
      .where(eq(contactPersons.id, personId))
      .limit(1);
    if (person) {
      const aliases = parseNameAliasesJson(person.nameAliasesJson).filter(
        (alias) => normalizeContactDeniedValue("name_alias", alias) !== deniedValue,
      );
      await db
        .update(contactPersons)
        .set({
          nameAliasesJson: serializeNameAliasesJson(aliases),
          updatedAt: nowIso,
        })
        .where(eq(contactPersons.id, personId));
    }
  }

  return { ok: true };
}
