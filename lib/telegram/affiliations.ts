/** Enqueue Telegram review for affiliation needs_review on a person set. */

import { inArray } from "drizzle-orm";

import { loadPendingAffiliationsForPerson } from "@/lib/affiliations/propose";
import { getDb } from "@/lib/db";
import { contactPersons, organizationEntities } from "@/lib/db/schema";
import { personDisplayName } from "@/lib/contacts/registry-shared";
import { insertAffiliationReviewItem } from "@/lib/telegram/store";

export async function enqueueAffiliationNeedsReview(input: {
  personIds: string[];
}): Promise<number> {
  const ids = [...new Set(input.personIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  const db = getDb();
  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
    })
    .from(contactPersons)
    .where(inArray(contactPersons.id, ids));
  const personById = new Map(persons.map((row) => [row.id, row]));

  let created = 0;
  for (const personId of ids) {
    const pending = await loadPendingAffiliationsForPerson(personId);
    const needsReview = pending.filter(
      (row) => row.evidence.aiAction === "needs_review",
    );
    if (needsReview.length === 0) continue;

    const orgIds = needsReview.map((row) => row.organizationId);
    const orgs =
      orgIds.length === 0
        ? []
        : await db
            .select({
              id: organizationEntities.id,
              name: organizationEntities.name,
            })
            .from(organizationEntities)
            .where(inArray(organizationEntities.id, orgIds));
    const orgById = new Map(orgs.map((row) => [row.id, row]));
    const person = personById.get(personId);

    for (const row of needsReview) {
      const inserted = await insertAffiliationReviewItem({
        holdReason: "needs_review",
        affiliationId: row.id,
        payload: {
          personId,
          personName: person
            ? personDisplayName(person)
            : personId,
          organizationId: row.organizationId,
          organizationName:
            orgById.get(row.organizationId)?.name?.trim() || row.organizationId,
          relationType: row.relationType,
          confidence: row.confidence,
          rationale: row.evidence.rationale ?? null,
        },
      });
      if (inserted && inserted.telegramMessageId == null) created += 1;
    }
  }

  return created;
}
