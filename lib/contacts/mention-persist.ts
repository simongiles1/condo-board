/**
 * Upsert per-email contact mentions from fingerprint cards.
 * Does not mint people. Resolution is a separate pass.
 */

import { randomUUID } from "crypto";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import {
  mentionCardAppearsInEmail,
  mentionSearchBody,
  parseAddressList,
  type MentionPresenceCard,
  type MentionPresenceEmail,
} from "@/lib/contacts/mention-presence";
import {
  buildMentionBlockingKeys,
  cardToMentionCard,
  contactMentionFingerprint,
  contactMentionSurfaceNeedle,
  mentionCardHasIdentity,
  mentionFirstNameKey,
  mentionFirstOrgKey,
  type ContactMentionCard,
  type ContactMentionKind,
} from "@/lib/contacts/mention-shared";
import { getDb } from "@/lib/db";
import { locateUniqueSurfaceSpan } from "@/lib/organizations/mention-shared";
import { contactHighlightExtractions, contactMentions, emails } from "@/lib/db/schema";
import {
  extractMailboxEmail,
  parseStoredFromAddress,
} from "@/lib/email/address-display";
import { resolveAuthoredBodiesForEvidence } from "@/lib/contacts/registry-evidence";
import { normalizeGivenNameToken } from "@/lib/contacts/person-name";
import {
  emptyContactHighlightExtraction,
  mergeContactHighlightExtractions,
  parseContactFingerprintResult,
  parseContactHighlightExtraction,
  type ContactEntityCard,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";

export type UpsertContactMentionsResult = {
  written: number;
  skipped: number;
};

const PRESENCE_EMAIL_BATCH = 200;

async function loadMentionPresenceByEmailId(
  emailIds: string[],
): Promise<Map<string, MentionPresenceEmail>> {
  const unique = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, MentionPresenceEmail>();
  if (unique.length === 0) return result;

  const db = getDb();
  for (let i = 0; i < unique.length; i += PRESENCE_EMAIL_BATCH) {
    const batch = unique.slice(i, i + PRESENCE_EMAIL_BATCH);
    const rows = await db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        subject: emails.subject,
        bodyText: emails.bodyText,
        bodyHtml: emails.bodyHtml,
        bodyTextUnique: emails.bodyTextUnique,
        bodyTextStrictUnique: emails.bodyTextStrictUnique,
        fromAddress: emails.fromAddress,
        toAddresses: emails.toAddresses,
        ccAddresses: emails.ccAddresses,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(inArray(emails.id, batch));
    const uniqueBodies = await resolveAuthoredBodiesForEvidence(rows);
    for (const row of rows) {
      result.set(row.id, {
        subject: row.subject,
        bodyText: row.bodyText,
        bodyTextUnique: row.bodyTextUnique,
        bodyTextStrictUnique: uniqueBodies.get(row.id) ?? row.bodyTextStrictUnique,
        fromAddress: row.fromAddress,
        toAddresses: row.toAddresses,
        ccAddresses: row.ccAddresses,
      });
    }
  }
  return result;
}

/** Keep only email ids where this card is visible on that message. */
export async function filterEmailIdsWhereMentionAppears(
  emailIds: string[],
  card: MentionPresenceCard,
): Promise<string[]> {
  const unique = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  const presenceById = await loadMentionPresenceByEmailId(unique);
  return unique.filter((id) => {
    const email = presenceById.get(id);
    return Boolean(email && mentionCardAppearsInEmail(card, email));
  });
}

function mentionCardFromStored(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
}): MentionPresenceCard {
  return {
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    phone: row.phone,
    job_title: row.jobTitle,
  };
}

/** Mention ids whose name/mailbox/phone is not on that source email's unique body or headers. */
export async function listMentionIdsMissingFromSourceEmail(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: contactMentions.id,
      firstName: contactMentions.firstName,
      lastName: contactMentions.lastName,
      email: contactMentions.email,
      phone: contactMentions.phone,
      jobTitle: contactMentions.jobTitle,
      sourceEmailId: contactMentions.sourceEmailId,
    })
    .from(contactMentions);

  const missing: string[] = [];
  for (let i = 0; i < rows.length; i += PRESENCE_EMAIL_BATCH) {
    const batch = rows.slice(i, i + PRESENCE_EMAIL_BATCH);
    const emailIds = [
      ...new Set(
        batch
          .map((row) => row.sourceEmailId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const presenceById = await loadMentionPresenceByEmailId(emailIds);
    for (const row of batch) {
      if (!row.sourceEmailId) continue;
      const email = presenceById.get(row.sourceEmailId);
      if (!email) continue;
      if (!mentionCardAppearsInEmail(mentionCardFromStored(row), email)) {
        missing.push(row.id);
      }
    }
  }
  return missing;
}

/** Pass-3 fingerprint cards keyed by email. Omits emails with no stored pass-3. */
export async function loadPass3EntityCardsByEmailId(params: {
  emailIds: string[];
  modelId?: string | null;
}): Promise<Map<string, ContactEntityCard[]>> {
  const unique = [
    ...new Set(params.emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const result = new Map<string, ContactEntityCard[]>();
  if (unique.length === 0) return result;

  const db = getDb();
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const filters = [
      inArray(contactHighlightExtractions.emailId, batch),
      isNotNull(contactHighlightExtractions.thirdPassExtractionJson),
    ];
    if (params.modelId?.trim()) {
      filters.push(
        eq(contactHighlightExtractions.modelId, params.modelId.trim()),
      );
    }
    const rows = await db
      .select({
        emailId: contactHighlightExtractions.emailId,
        thirdPassExtractionJson:
          contactHighlightExtractions.thirdPassExtractionJson,
      })
      .from(contactHighlightExtractions)
      .where(and(...filters));
    for (const row of rows) {
      if (result.has(row.emailId) || !row.thirdPassExtractionJson) continue;
      try {
        result.set(
          row.emailId,
          parseContactFingerprintResult(JSON.parse(row.thirdPassExtractionJson))
            .entity_cards,
        );
      } catch {
        result.set(row.emailId, []);
      }
    }
  }
  return result;
}

function classifyMentionKind(
  card: ContactMentionCard,
  headerLines: string[],
): ContactMentionKind {
  const mentionEmail = card.email ? extractMailboxEmail(card.email) : null;
  const headerEmails = new Set<string>();
  const headerFirsts = new Set<string>();
  for (const line of headerLines) {
    const parsed = parseStoredFromAddress(line);
    const mailbox = parsed.email
      ? extractMailboxEmail(parsed.email)
      : extractMailboxEmail(line);
    if (mailbox) headerEmails.add(mailbox.toLowerCase());
    const first = parsed.name?.trim().split(/\s+/)[0];
    if (first && first.replace(/\./g, "").length >= 2) {
      headerFirsts.add(normalizeGivenNameToken(first));
    }
  }

  if (mentionEmail && headerEmails.has(mentionEmail.toLowerCase())) {
    return "participant";
  }
  const first = mentionFirstNameKey(card.first_name);
  if (first && headerFirsts.has(first)) return "participant";
  if (card.first_name || card.last_name) return "referred";
  return "unknown";
}

export async function upsertContactMentionsForEmail(params: {
  sourceEmailId: string;
  entityCards: ContactEntityCard[];
  extraction?: ContactHighlightExtraction | null;
  modelId?: string | null;
  fingerprintMergeId?: string | null;
}): Promise<UpsertContactMentionsResult> {
  const sourceEmailId = params.sourceEmailId.trim();
  if (!sourceEmailId) return { written: 0, skipped: 0 };

  const db = getDb();
  const presenceById = await loadMentionPresenceByEmailId([sourceEmailId]);
  const presence = presenceById.get(sourceEmailId);
  if (!presence) return { written: 0, skipped: params.entityCards.length };

  const headerLines = [
    presence.fromAddress,
    ...parseAddressList(presence.toAddresses),
    ...parseAddressList(presence.ccAddresses),
  ].filter((line): line is string => Boolean(line?.trim()));

  const now = new Date().toISOString();
  let written = 0;
  let skipped = 0;

  for (const raw of params.entityCards) {
    const card = cardToMentionCard(raw, params.extraction);
    if (!mentionCardHasIdentity(card)) {
      skipped += 1;
      continue;
    }
    const fingerprint = contactMentionFingerprint(card);
    if (!fingerprint.replace(/\|/g, "")) {
      skipped += 1;
      continue;
    }
    if (!mentionCardAppearsInEmail(card, presence)) {
      skipped += 1;
      continue;
    }

    const mentionKind = classifyMentionKind(card, headerLines);
    const firstNameKey = mentionFirstNameKey(card.first_name);
    const firstOrgKey = mentionFirstOrgKey({
      firstName: card.first_name,
      rawCompany: card.raw_company,
    });
    const blockingKeysJson = JSON.stringify(buildMentionBlockingKeys(card));
    const span = locateUniqueSurfaceSpan(
      mentionSearchBody(presence),
      contactMentionSurfaceNeedle(card),
    );

    const [existing] = await db
      .select({
        id: contactMentions.id,
        resolutionStatus: contactMentions.resolutionStatus,
        resolvedPersonId: contactMentions.resolvedPersonId,
        resolvedOrganizationId: contactMentions.resolvedOrganizationId,
        resolutionReason: contactMentions.resolutionReason,
      })
      .from(contactMentions)
      .where(
        and(
          eq(contactMentions.sourceEmailId, sourceEmailId),
          eq(contactMentions.fingerprint, fingerprint),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(contactMentions)
        .set({
          firstName: card.first_name,
          lastName: card.last_name,
          email: card.email,
          phone: card.phone,
          jobTitle: card.job_title,
          rolePhrase: card.role_phrase ?? null,
          rawCompany: card.raw_company,
          mentionKind,
          firstNameKey,
          firstOrgKey,
          blockingKeysJson,
          modelId: params.modelId ?? null,
          fingerprintMergeId: params.fingerprintMergeId ?? null,
          startOffset: span?.start ?? null,
          endOffset: span?.end ?? null,
          updatedAt: now,
        })
        .where(eq(contactMentions.id, existing.id));
      written += 1;
      continue;
    }

    await db.insert(contactMentions).values({
      id: randomUUID(),
      sourceEmailId,
      fingerprintMergeId: params.fingerprintMergeId ?? null,
      modelId: params.modelId ?? null,
      firstName: card.first_name,
      lastName: card.last_name,
      email: card.email,
      phone: card.phone,
      jobTitle: card.job_title,
      rolePhrase: card.role_phrase ?? null,
      rawCompany: card.raw_company,
      mentionKind,
      fingerprint,
      firstNameKey,
      firstOrgKey,
      blockingKeysJson,
      resolutionStatus: "unresolved",
      candidatePersonIdsJson: "[]",
      startOffset: span?.start ?? null,
      endOffset: span?.end ?? null,
      resolvedPersonId: null,
      resolvedOrganizationId: null,
      resolutionReason: null,
      createdAt: now,
      updatedAt: now,
    });
    written += 1;
  }

  const stored = await db
    .select({
      id: contactMentions.id,
      firstName: contactMentions.firstName,
      lastName: contactMentions.lastName,
      email: contactMentions.email,
      phone: contactMentions.phone,
      jobTitle: contactMentions.jobTitle,
    })
    .from(contactMentions)
    .where(eq(contactMentions.sourceEmailId, sourceEmailId));
  const dropIds = stored
    .filter((row) => !mentionCardAppearsInEmail(mentionCardFromStored(row), presence))
    .map((row) => row.id);
  if (dropIds.length > 0) {
    await db
      .delete(contactMentions)
      .where(inArray(contactMentions.id, dropIds));
  }

  return { written, skipped };
}

export async function upsertContactMentionsForEmails(params: {
  emailIds: string[];
  entityCards: ContactEntityCard[];
  extractionByEmailId?: Map<string, ContactHighlightExtraction>;
  modelId?: string | null;
  fingerprintMergeId?: string | null;
}): Promise<UpsertContactMentionsResult> {
  const totals = { written: 0, skipped: 0 };
  const emailIds = [...new Set(params.emailIds.map((id) => id.trim()).filter(Boolean))];
  for (const emailId of emailIds) {
    const result = await upsertContactMentionsForEmail({
      sourceEmailId: emailId,
      entityCards: params.entityCards,
      extraction: params.extractionByEmailId?.get(emailId) ?? null,
      modelId: params.modelId,
      fingerprintMergeId: params.fingerprintMergeId,
    });
    totals.written += result.written;
    totals.skipped += result.skipped;
  }
  return totals;
}

export async function loadMergedHighlightExtraction(
  emailId: string,
  modelId: string,
): Promise<ContactHighlightExtraction | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(contactHighlightExtractions)
    .where(
      and(
        eq(contactHighlightExtractions.emailId, emailId),
        eq(contactHighlightExtractions.modelId, modelId),
      ),
    )
    .limit(1);
  if (!row) return null;

  let first = emptyContactHighlightExtraction();
  let second = emptyContactHighlightExtraction();
  try {
    first = row.extractionJson
      ? parseContactHighlightExtraction(JSON.parse(row.extractionJson))
      : emptyContactHighlightExtraction();
  } catch {
    first = emptyContactHighlightExtraction();
  }
  try {
    second = row.secondPassExtractionJson
      ? parseContactHighlightExtraction(JSON.parse(row.secondPassExtractionJson))
      : emptyContactHighlightExtraction();
  } catch {
    second = emptyContactHighlightExtraction();
  }
  return mergeContactHighlightExtractions([first, second]);
}
