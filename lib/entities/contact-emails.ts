/** Multiple email addresses per approved person contact. */

import { randomUUID } from "crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactEmails,
  emails,
  entityMentions,
  extractionSources,
} from "@/lib/db/schema";
import { parseStoredFromAddress } from "@/lib/email/address-display";
import { entitiesMatch, normalizePersonName } from "@/lib/email/entity-dedup";
import {
  isEntityExcluded,
  loadEntityExclusions,
} from "@/lib/entities/entity-exclusions";
import {
  buildEntityDedupKey,
  extractEmailFromText,
} from "@/lib/entities/entity-review";

export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ApprovedPersonContact = {
  dedupKey: string;
  name: string;
  emails: string[];
};

export type PendingAdditionalEmail = {
  id: string;
  email: string;
  personName: string;
  personDedupKey: string;
  context: string | null;
  sourceId: string | null;
  existingEmails: string[];
};

function extractEmailsFromText(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const matches = text.match(/[\w.+-]+@[\w.-]+\.\w+/gi) ?? [];
  return [...new Set(matches.map((email) => normalizeContactEmail(email)))];
}

function emailBelongsToPerson(email: string, personName: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return false;
  const normalized = normalizePersonName(personName);
  if (local === normalized.replace(/\s+/g, "")) return true;
  const first = normalized.split(/\s+/)[0];
  return local === first || normalized.startsWith(`${local} `);
}

function findMatchingApprovedPerson(
  personName: string | null | undefined,
  email: string,
  approved: ApprovedPersonContact[],
): ApprovedPersonContact | undefined {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return undefined;

  if (personName?.trim()) {
    const match = approved.find((person) =>
      entitiesMatch(
        { type: "person", value: person.name },
        { type: "person", value: personName },
      ),
    );
    if (match) return match;
  }

  return approved.find((person) =>
    emailBelongsToPerson(normalizedEmail, person.name),
  );
}

export async function loadApprovedPersonContacts(): Promise<ApprovedPersonContact[]> {
  const db = getDb();

  const approvedPersons = await db
    .select({
      entityValue: entityMentions.entityValue,
      dedupKey: entityMentions.dedupKey,
      contactEmail: entityMentions.contactEmail,
    })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.reviewStatus, "approved"),
        eq(entityMentions.entityType, "person"),
      ),
    );

  const approvedEmailRows = await db
    .select({
      personDedupKey: contactEmails.personDedupKey,
      email: contactEmails.email,
    })
    .from(contactEmails)
    .where(eq(contactEmails.reviewStatus, "approved"));

  const emailsByPerson = new Map<string, Set<string>>();
  for (const row of approvedEmailRows) {
    const normalized = normalizeContactEmail(row.email);
    if (!normalized) continue;
    const bucket = emailsByPerson.get(row.personDedupKey) ?? new Set<string>();
    bucket.add(normalized);
    emailsByPerson.set(row.personDedupKey, bucket);
  }

  const contacts: ApprovedPersonContact[] = [];
  for (const person of approvedPersons) {
    const dedupKey =
      person.dedupKey?.trim() ||
      buildEntityDedupKey({ type: "person", value: person.entityValue });
    const knownEmails = emailsByPerson.get(dedupKey) ?? new Set<string>();

    if (person.contactEmail?.trim()) {
      knownEmails.add(normalizeContactEmail(person.contactEmail));
    }

    contacts.push({
      dedupKey,
      name: person.entityValue,
      emails: [...knownEmails].filter(Boolean).sort(),
    });
  }

  return contacts;
}

export async function loadPendingAdditionalEmails(): Promise<
  PendingAdditionalEmail[]
> {
  const db = getDb();
  const approved = await loadApprovedPersonContacts();
  const approvedByKey = new Map(approved.map((person) => [person.dedupKey, person]));

  const rows = await db
    .select({
      id: contactEmails.id,
      email: contactEmails.email,
      personDedupKey: contactEmails.personDedupKey,
      personName: contactEmails.personName,
      context: contactEmails.context,
      sourceId: contactEmails.sourceId,
    })
    .from(contactEmails)
    .where(eq(contactEmails.reviewStatus, "pending"))
    .orderBy(asc(contactEmails.personName), asc(contactEmails.email));

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    personName: row.personName,
    personDedupKey: row.personDedupKey,
    context: row.context,
    sourceId: row.sourceId,
    existingEmails: approvedByKey.get(row.personDedupKey)?.emails ?? [],
  }));
}

export async function loadApprovedEmailsByPersonDedupKey(): Promise<
  Map<string, string[]>
> {
  const approved = await loadApprovedPersonContacts();
  return new Map(approved.map((person) => [person.dedupKey, person.emails]));
}

export async function upsertApprovedContactEmail(input: {
  personDedupKey: string;
  personName: string;
  email: string;
  sourceId?: string | null;
  context?: string | null;
}): Promise<void> {
  const normalized = normalizeContactEmail(input.email);
  if (!normalized) return;

  const db = getDb();
  const [existing] = await db
    .select({ id: contactEmails.id, reviewStatus: contactEmails.reviewStatus })
    .from(contactEmails)
    .where(
      and(
        eq(contactEmails.personDedupKey, input.personDedupKey),
        eq(contactEmails.email, normalized),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.reviewStatus !== "approved") {
      await db
        .update(contactEmails)
        .set({ reviewStatus: "approved" })
        .where(eq(contactEmails.id, existing.id));
    }
    return;
  }

  await db.insert(contactEmails).values({
    id: randomUUID(),
    email: normalized,
    personDedupKey: input.personDedupKey,
    personName: input.personName.trim(),
    reviewStatus: "approved",
    context: input.context ?? null,
    sourceId: input.sourceId ?? null,
    createdAt: new Date().toISOString(),
  });
}

export async function registerPendingAdditionalEmail(input: {
  personDedupKey: string;
  personName: string;
  email: string;
  context?: string | null;
  sourceId: string;
}): Promise<"inserted" | "skipped"> {
  const normalized = normalizeContactEmail(input.email);
  if (!normalized) return "skipped";

  const exclusions = await loadEntityExclusions();
  if (isEntityExcluded({ type: "email", value: normalized }, exclusions)) {
    return "skipped";
  }

  const approved = await loadApprovedPersonContacts();
  const person = approved.find(
    (entry) => entry.dedupKey === input.personDedupKey,
  );
  if (!person) return "skipped";

  if (person.emails.includes(normalized)) return "skipped";

  const db = getDb();
  const [existing] = await db
    .select({ id: contactEmails.id })
    .from(contactEmails)
    .where(
      and(
        eq(contactEmails.personDedupKey, input.personDedupKey),
        eq(contactEmails.email, normalized),
        inArray(contactEmails.reviewStatus, ["pending", "approved"]),
      ),
    )
    .limit(1);
  if (existing) return "skipped";

  await db.insert(contactEmails).values({
    id: randomUUID(),
    email: normalized,
    personDedupKey: input.personDedupKey,
    personName: person.name,
    reviewStatus: "pending",
    context: input.context ?? null,
    sourceId: input.sourceId,
    createdAt: new Date().toISOString(),
  });

  return "inserted";
}

export async function detectAdditionalContactEmailsForThread(input: {
  threadId: string;
  sourceId: string;
}): Promise<number> {
  const approved = await loadApprovedPersonContacts();
  if (!approved.length) return 0;

  const db = getDb();
  const [threadMessages, threadPersonMentions] = await Promise.all([
    db
      .select({
        fromAddress: emails.fromAddress,
        subject: emails.subject,
      })
      .from(emails)
      .where(eq(emails.threadId, input.threadId)),
    db
      .select({
        entityValue: entityMentions.entityValue,
        context: entityMentions.context,
      })
      .from(entityMentions)
      .innerJoin(
        extractionSources,
        eq(entityMentions.sourceId, extractionSources.id),
      )
      .where(
        and(
          eq(extractionSources.emailThreadId, input.threadId),
          eq(entityMentions.entityType, "person"),
        ),
      ),
  ]);

  const candidates = new Map<
    string,
    { person: ApprovedPersonContact; email: string; context: string }
  >();

  for (const message of threadMessages) {
    const parsed = parseStoredFromAddress(message.fromAddress);
    if (!parsed.email) continue;

    const matchedPerson = findMatchingApprovedPerson(
      parsed.name,
      parsed.email,
      approved,
    );
    if (!matchedPerson) continue;

    const email = normalizeContactEmail(parsed.email);
    const key = `${matchedPerson.dedupKey}|${email}`;
    candidates.set(key, {
      person: matchedPerson,
      email,
      context: `From: ${message.fromAddress}${message.subject ? ` — ${message.subject}` : ""}`,
    });
  }

  for (const mention of threadPersonMentions) {
    const matchedPerson = approved.find((person) =>
      entitiesMatch(
        { type: "person", value: person.name },
        { type: "person", value: mention.entityValue },
      ),
    );
    if (!matchedPerson) continue;

    const contextEmails = extractEmailsFromText(mention.context);
    for (const email of contextEmails) {
      const key = `${matchedPerson.dedupKey}|${email}`;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        person: matchedPerson,
        email,
        context:
          mention.context?.trim() ||
          extractEmailFromText(mention.context) ||
          `Mentioned in thread for ${matchedPerson.name}`,
      });
    }
  }

  let inserted = 0;
  for (const candidate of candidates.values()) {
    const result = await registerPendingAdditionalEmail({
      personDedupKey: candidate.person.dedupKey,
      personName: candidate.person.name,
      email: candidate.email,
      context: candidate.context,
      sourceId: input.sourceId,
    });
    if (result === "inserted") inserted += 1;
  }

  return inserted;
}

export async function approvePendingContactEmail(input: {
  contactEmailId: string;
  email?: string;
}): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(contactEmails)
    .where(eq(contactEmails.id, input.contactEmailId))
    .limit(1);

  if (!row || row.reviewStatus !== "pending") {
    throw new Error("Pending additional email not found");
  }

  const normalized = normalizeContactEmail(input.email ?? row.email);
  if (!normalized) {
    throw new Error("Email address is required");
  }

  if (normalized !== row.email) {
    const [duplicate] = await db
      .select({ id: contactEmails.id })
      .from(contactEmails)
      .where(
        and(
          eq(contactEmails.personDedupKey, row.personDedupKey),
          eq(contactEmails.email, normalized),
          inArray(contactEmails.reviewStatus, ["pending", "approved"]),
        ),
      )
      .limit(1);

    if (duplicate && duplicate.id !== row.id) {
      await db.delete(contactEmails).where(eq(contactEmails.id, row.id));
      return;
    }
  }

  await db
    .update(contactEmails)
    .set({
      email: normalized,
      reviewStatus: "approved",
    })
    .where(eq(contactEmails.id, row.id));
}

export async function rejectPendingContactEmail(
  contactEmailId: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: contactEmails.id, reviewStatus: contactEmails.reviewStatus })
    .from(contactEmails)
    .where(eq(contactEmails.id, contactEmailId))
    .limit(1);

  if (!row || row.reviewStatus !== "pending") {
    throw new Error("Pending additional email not found");
  }

  await db.delete(contactEmails).where(eq(contactEmails.id, contactEmailId));
}

export async function registerAdditionalEmailFromReconciliation(input: {
  personName: string;
  email: string;
  context?: string | null;
  sourceId: string;
  approvedRows: Array<{
    entityType: string;
    entityValue: string;
    dedupKey: string | null;
  }>;
}): Promise<"inserted" | "skipped"> {
  const normalized = normalizeContactEmail(input.email);
  if (!normalized || !input.personName.trim()) return "skipped";

  const approvedMatch = input.approvedRows.find(
    (row) =>
      row.entityType === "person" &&
      entitiesMatch(
        { type: "person", value: row.entityValue },
        { type: "person", value: input.personName },
      ),
  );
  if (!approvedMatch) return "skipped";

  const personDedupKey =
    approvedMatch.dedupKey?.trim() ||
    buildEntityDedupKey({ type: "person", value: approvedMatch.entityValue });

  return registerPendingAdditionalEmail({
    personDedupKey,
    personName: approvedMatch.entityValue,
    email: normalized,
    context: input.context,
    sourceId: input.sourceId,
  });
}
