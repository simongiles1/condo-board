import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import {
  ENTITY_RECONCILIATION_SYSTEM_PROMPT,
  buildEntityReconciliationUserPrompt,
} from "@/lib/email-analysis/prompts";
import { getDb } from "@/lib/db";
import { emails, entityMentions, extractionSources } from "@/lib/db/schema";
import {
  formatEntityExclusionsForPrompt,
  isExcludedContact,
  loadEntityExclusions,
} from "@/lib/entities/entity-exclusions";
import {
  buildEntityDedupKey,
  findApprovedEntityMatch,
  type EntityMentionRow,
} from "@/lib/entities/entity-review";
import {
  loadApprovedPersonContacts,
  registerAdditionalEmailFromReconciliation,
} from "@/lib/entities/contact-emails";
import { isAuditEntityType } from "@/lib/email/entity-grouping";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

const MAX_THREAD_CHARS = 120_000;
const RECONCILIATION_MAX_OUTPUT_TOKENS = 8192;

export type ReconciledContact = {
  person?: string;
  org?: string;
  phone?: string;
  unit?: string;
  title?: string;
  email?: string;
  vendor_candidate?: boolean;
  context?: string;
};

export type EntityReconciliationResult = {
  contacts: ReconciledContact[];
};

export type ReconcileThreadEntitiesResult = {
  beforeCount: number;
  afterCount: number;
  calls: GeminiUsageCall[];
  costUsd: number;
};

type PendingEntity = {
  id: string;
  entityType: string;
  entityValue: string;
  context: string | null;
  vendorCandidate: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseEntityReconciliationResult(
  raw: unknown,
): EntityReconciliationResult {
  if (!isObject(raw)) return { contacts: [] };

  const contactsRaw = raw.contacts;
  if (!Array.isArray(contactsRaw)) return { contacts: [] };

  const contacts: ReconciledContact[] = [];
  for (const entry of contactsRaw) {
    if (!isObject(entry)) continue;

    const person = asString(entry.person);
    const org = asString(entry.org);
    const phone = asString(entry.phone);
    const unit = asString(entry.unit);
    const title = asString(entry.title);
    const email = asString(entry.email);
    if (!person && !org && !unit) continue;

    contacts.push({
      person,
      org,
      phone,
      unit,
      title,
      email,
      vendor_candidate: asBoolean(entry.vendor_candidate),
      context: asString(entry.context),
    });
  }

  return { contacts };
}

function buildThreadTranscript(
  messages: Array<{
    fromAddress: string;
    subject: string;
    receivedAt: string;
    bodyTextUnique: string | null;
    bodyText: string;
  }>,
): string {
  const blocks = messages.map((message, index) => {
    const body = (message.bodyTextUnique ?? message.bodyText).trim();
    return [
      `--- Message ${index + 1} ---`,
      `From: ${message.fromAddress}`,
      `Date: ${message.receivedAt}`,
      `Subject: ${message.subject}`,
      "Body:",
      body,
    ].join("\n");
  });

  let transcript = blocks.join("\n\n");
  if (transcript.length > MAX_THREAD_CHARS) {
    transcript = `${transcript.slice(-MAX_THREAD_CHARS)}\n\n[Thread truncated to the most recent ${MAX_THREAD_CHARS} characters.]`;
  }

  return transcript;
}

async function loadPendingThreadEntities(
  threadId: string,
): Promise<PendingEntity[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      vendorCandidate: entityMentions.vendorCandidate,
    })
    .from(entityMentions)
    .innerJoin(
      extractionSources,
      eq(entityMentions.sourceId, extractionSources.id),
    )
    .where(
      and(
        eq(extractionSources.emailThreadId, threadId),
        eq(entityMentions.reviewStatus, "pending"),
      ),
    );

  return rows.filter((row) => isAuditEntityType(row.entityType));
}

async function loadApprovedEntityRows(): Promise<EntityMentionRow[]> {
  const db = getDb();
  return db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      reviewStatus: entityMentions.reviewStatus,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
      dedupKey: entityMentions.dedupKey,
      contactEmail: entityMentions.contactEmail,
    })
    .from(entityMentions)
    .where(eq(entityMentions.reviewStatus, "approved"));
}

async function loadThreadMessages(threadId: string) {
  const db = getDb();
  return db
    .select({
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      bodyTextUnique: emails.bodyTextUnique,
      bodyText: emails.bodyText,
    })
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .orderBy(asc(emails.receivedAt));
}

async function deletePendingThreadEntityMentions(
  threadId: string,
): Promise<void> {
  const db = getDb();
  const pendingRows = await db
    .select({ id: entityMentions.id })
    .from(entityMentions)
    .innerJoin(
      extractionSources,
      eq(entityMentions.sourceId, extractionSources.id),
    )
    .where(
      and(
        eq(extractionSources.emailThreadId, threadId),
        eq(entityMentions.reviewStatus, "pending"),
      ),
    );

  for (const row of pendingRows) {
    await db.delete(entityMentions).where(eq(entityMentions.id, row.id));
  }
}

async function insertReconciledContactFields(input: {
  contact: ReconciledContact;
  sourceId: string;
  approvedRows: EntityMentionRow[];
  now: string;
}): Promise<number> {
  const db = getDb();
  let inserted = 0;

  const fields: Array<{
    type: string;
    value: string;
    vendorCandidate: boolean;
  }> = [];

  if (input.contact.person) {
    fields.push({
      type: "person",
      value: input.contact.person,
      vendorCandidate: false,
    });
  }
  if (input.contact.org) {
    fields.push({
      type: "org",
      value: input.contact.org,
      vendorCandidate: input.contact.vendor_candidate ?? false,
    });
  }
  if (input.contact.phone) {
    fields.push({
      type: "phone",
      value: input.contact.phone,
      vendorCandidate: false,
    });
  }
  if (input.contact.unit) {
    fields.push({
      type: "unit",
      value: input.contact.unit,
      vendorCandidate: false,
    });
  }

  for (const field of fields) {
    const approvedMatch = findApprovedEntityMatch(input.approvedRows, field);
    const dedupKey = approvedMatch?.dedupKey ?? buildEntityDedupKey(field);

    await db.insert(entityMentions).values({
      id: randomUUID(),
      entityType: field.type,
      entityValue: field.value,
      context: input.contact.context ?? null,
      reviewStatus: approvedMatch ? "approved" : "pending",
      organizationRole: approvedMatch?.organizationRole ?? null,
      vendorCandidate: field.vendorCandidate,
      dedupKey,
      personTitle:
        field.type === "person" ? input.contact.title ?? null : null,
      linkedOrganizationName:
        field.type === "person" ? input.contact.org ?? null : null,
      sourceId: input.sourceId,
      createdAt: input.now,
    });
    inserted += 1;
  }

  return inserted;
}

export async function reconcileThreadEntities(input: {
  threadId: string;
  sourceId: string;
  modelName: string;
}): Promise<ReconcileThreadEntitiesResult> {
  const pendingEntities = await loadPendingThreadEntities(input.threadId);
  if (pendingEntities.length < 2) {
    return {
      beforeCount: pendingEntities.length,
      afterCount: pendingEntities.length,
      calls: [],
      costUsd: 0,
    };
  }

  const threadMessages = await loadThreadMessages(input.threadId);
  if (!threadMessages.length) {
    return {
      beforeCount: pendingEntities.length,
      afterCount: pendingEntities.length,
      calls: [],
      costUsd: 0,
    };
  }

  const approvedRows = await loadApprovedEntityRows();
  const approvedPersonContacts = await loadApprovedPersonContacts();
  const exclusions = await loadEntityExclusions();
  const userPrompt = buildEntityReconciliationUserPrompt({
    threadTranscript: buildThreadTranscript(threadMessages),
    extractedEntities: pendingEntities.map((entity) => ({
      id: entity.id,
      type: entity.entityType,
      value: entity.entityValue,
      context: entity.context,
      vendor_candidate: entity.vendorCandidate,
    })),
    approvedEntities: approvedRows.map((row) => ({
      type: row.entityType,
      value: row.entityValue,
      organization_role: row.organizationRole,
    })),
    approvedContacts: approvedPersonContacts.map((contact) => ({
      person: contact.name,
      known_emails: contact.emails,
    })),
    excludedEntitiesSection: formatEntityExclusionsForPrompt(exclusions),
  });

  const generation = await generateEmailExtraction({
    systemInstruction: ENTITY_RECONCILIATION_SYSTEM_PROMPT,
    userText: userPrompt,
    modelName: input.modelName,
    maxOutputTokens: RECONCILIATION_MAX_OUTPUT_TOKENS,
    step: "entity_reconciliation",
  });

  const { jsonText } = unwrapJsonCodeBlock(generation.text);
  const parsed = parseEntityReconciliationResult(
    JSON.parse(jsonText) as unknown,
  );
  parsed.contacts = parsed.contacts.filter(
    (contact) =>
      !isExcludedContact({
        person: contact.person,
        org: contact.org,
        phone: contact.phone,
        exclusions,
      }),
  );

  if (!parsed.contacts.length) {
    console.warn("[email-analysis:entity-reconcile]", {
      threadId: input.threadId,
      message: "AI returned no contacts; keeping original pending entities",
    });
    return {
      beforeCount: pendingEntities.length,
      afterCount: pendingEntities.length,
      calls: generation.usageCalls,
      costUsd: estimateCostUsdForCalls(generation.usageCalls),
    };
  }

  await deletePendingThreadEntityMentions(input.threadId);

  const now = new Date().toISOString();
  let afterCount = 0;
  for (const contact of parsed.contacts) {
    afterCount += await insertReconciledContactFields({
      contact,
      sourceId: input.sourceId,
      approvedRows,
      now,
    });

    if (contact.email && contact.person) {
      await registerAdditionalEmailFromReconciliation({
        personName: contact.person,
        email: contact.email,
        context: contact.context,
        sourceId: input.sourceId,
        approvedRows,
      });
    }
  }

  const calls = generation.usageCalls;
  const costUsd = estimateCostUsdForCalls(calls);

  console.info("[email-analysis:entity-reconcile]", {
    threadId: input.threadId,
    beforeCount: pendingEntities.length,
    afterCount,
    contactCount: parsed.contacts.length,
    costUsd,
  });

  return {
    beforeCount: pendingEntities.length,
    afterCount,
    calls,
    costUsd,
  };
}
