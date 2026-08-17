/** Resolve who owned an email address at a point in time. */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactEmailIndex,
  contactPersonEmails,
  contactPersons,
} from "@/lib/db/schema";
import {
  normalizeContactRegistryEmail,
  occupancyCoversAt,
  personDisplayName,
  pickCurrentOccupancyPersonId,
} from "@/lib/contacts/registry-shared";

export type PersonAtTimeResult = {
  email: string;
  at: string;
  personId: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** True when result came from current index because no dated occupancy matched. */
  usedCurrentFallback: boolean;
};

/**
 * Historical report helper: who was associated with `email` at timestamp `at`.
 * Prefers occupancy intervals; falls back to contact_email_index current person.
 */
export async function resolvePersonAtTime(
  emailRaw: string,
  atRaw?: string | null,
): Promise<PersonAtTimeResult> {
  const email = normalizeContactRegistryEmail(emailRaw);
  const at = (atRaw?.trim() || new Date().toISOString()).trim();

  const empty: PersonAtTimeResult = {
    email,
    at,
    personId: null,
    firstName: null,
    lastName: null,
    displayName: null,
    validFrom: null,
    validTo: null,
    usedCurrentFallback: false,
  };
  if (!email) return empty;

  const db = getDb();
  const rows = await db
    .select()
    .from(contactPersonEmails)
    .where(eq(contactPersonEmails.email, email));

  const covering = rows.filter((r) =>
    occupancyCoversAt(r.validFrom, r.validTo, at),
  );

  let chosen = covering[0] ?? null;
  if (covering.length > 1) {
    const open = covering.filter((r) => !r.validTo);
    const pool = open.length > 0 ? open : covering;
    pool.sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
    chosen = pool[0] ?? null;
  }

  let usedCurrentFallback = false;
  let personId: string | null = chosen?.personId ?? null;

  if (!personId) {
    const [indexRow] = await db
      .select()
      .from(contactEmailIndex)
      .where(eq(contactEmailIndex.email, email))
      .limit(1);
    personId = indexRow?.currentPersonId ?? null;
    usedCurrentFallback = Boolean(personId);
    if (!personId && rows.length > 0) {
      personId = pickCurrentOccupancyPersonId(
        rows.map((r) => ({
          personId: r.personId,
          validFrom: r.validFrom,
          validTo: r.validTo,
        })),
        at,
      );
    }
  }

  if (!personId) return empty;

  const [person] = await db
    .select()
    .from(contactPersons)
    .where(eq(contactPersons.id, personId))
    .limit(1);

  return {
    email,
    at,
    personId,
    firstName: person?.firstName ?? null,
    lastName: person?.lastName ?? null,
    displayName: person
      ? personDisplayName({
          firstName: person.firstName,
          lastName: person.lastName,
          emails: [{ email }],
        })
      : null,
    validFrom: chosen?.validFrom ?? null,
    validTo: chosen?.validTo ?? null,
    usedCurrentFallback,
  };
}
