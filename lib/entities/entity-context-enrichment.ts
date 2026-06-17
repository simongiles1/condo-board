/** Server-only: expand entity review snippets using full email thread text. */

import { access, readFile, writeFile } from "fs/promises";
import path from "path";

import { asc, eq, inArray } from "drizzle-orm";

import { resolveExtractionSourceEmails } from "@/lib/building/resolve-source-email";
import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  entityMentions,
  extractionSources,
} from "@/lib/db/schema";
import {
  collectEntitySearchTerms,
  composeLinkContext,
  extractPassagesFromCorpus,
} from "@/lib/entities/entity-context-snippet";
import type { EntityMentionRow, EntityReviewGroup } from "@/lib/entities/entity-review";
import { extractPdfText } from "@/lib/parsers/pdf";

type ThreadMetadata = {
  subject: string | null;
  summaries: string[];
  attachmentNames: string[];
};

type ThreadEntityContext = {
  entityValue: string;
  context: string;
};

type EnrichmentCorpus = {
  sourceThreadIds: Map<string, string | null>;
  threadTexts: Map<string, string>;
  threadExtractionTexts: Map<string, string>;
  threadAttachmentTexts: Map<string, string>;
  threadMetadata: Map<string, ThreadMetadata>;
  threadEntityContexts: Map<string, ThreadEntityContext[]>;
};

const TOPIC_PATTERN =
  /\b(bond|surety|tender|insurance|bid|performance|labour|material|contractor|vendor)\b/i;

function collectStoredContexts(
  group: EntityReviewGroup,
  rowsById: Map<string, EntityMentionRow>,
): string[] {
  const contexts = new Set<string>();

  if (group.linkContext?.trim()) {
    contexts.add(group.linkContext.trim());
  }

  for (const field of [group.person, group.org, group.phone, group.unit]) {
    if (!field) continue;
    for (const context of field.contexts) {
      if (context.trim()) contexts.add(context.trim());
    }
  }

  for (const mentionId of group.mentionIds) {
    const row = rowsById.get(mentionId);
    if (row?.context?.trim()) contexts.add(row.context.trim());
  }

  return [...contexts];
}

function threadIdsForGroup(
  group: EntityReviewGroup,
  rowsById: Map<string, EntityMentionRow>,
  sourceThreadIds: Map<string, string | null>,
): string[] {
  const threadIds = new Set<string>();

  for (const mentionId of group.mentionIds) {
    const row = rowsById.get(mentionId);
    if (!row?.sourceId) continue;
    const threadId = sourceThreadIds.get(row.sourceId);
    if (threadId) threadIds.add(threadId);
  }

  return [...threadIds];
}

function collectJsonStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length >= 20) output.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectJsonStrings(entry, output);
    return;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectJsonStrings(entry, output);
  }
}

function buildExtractionCorpus(rawJson: string): string {
  try {
    const strings: string[] = [];
    collectJsonStrings(JSON.parse(rawJson) as unknown, strings);
    return [...new Set(strings)].join("\n\n");
  } catch {
    return "";
  }
}

async function loadSourceThreadIds(
  sourceIds: string[],
): Promise<Map<string, string | null>> {
  if (sourceIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      id: extractionSources.id,
      emailThreadId: extractionSources.emailThreadId,
    })
    .from(extractionSources)
    .where(inArray(extractionSources.id, sourceIds));

  const map = new Map(rows.map((row) => [row.id, row.emailThreadId]));
  const unresolved = sourceIds.filter((sourceId) => !map.get(sourceId));
  if (unresolved.length === 0) return map;

  const resolved = await resolveExtractionSourceEmails(unresolved);
  for (const [sourceId, email] of resolved) {
    if (!map.get(sourceId) && email.threadId) {
      map.set(sourceId, email.threadId);
    }
  }

  return map;
}

async function loadThreadTexts(
  threadIds: string[],
): Promise<Map<string, string>> {
  if (threadIds.length === 0) return new Map();

  const db = getDb();
  const messages = await db
    .select({
      threadId: emails.threadId,
      subject: emails.subject,
      bodyTextUnique: emails.bodyTextUnique,
      bodyText: emails.bodyText,
    })
    .from(emails)
    .where(inArray(emails.threadId, threadIds))
    .orderBy(asc(emails.receivedAt));

  const threadTexts = new Map<string, string[]>();

  for (const message of messages) {
    if (!message.threadId) continue;
    const parts = [message.bodyText, message.bodyTextUnique]
      .map((body) => body?.trim())
      .filter(Boolean) as string[];
    if (parts.length === 0) continue;

    const bucket = threadTexts.get(message.threadId) ?? [];
    if (message.subject?.trim()) {
      bucket.push(`Subject: ${message.subject.trim()}`);
    }
    bucket.push(...parts);
    threadTexts.set(message.threadId, bucket);
  }

  return new Map(
    [...threadTexts.entries()].map(([threadId, bodies]) => [
      threadId,
      bodies.join("\n\n"),
    ]),
  );
}

async function loadThreadExtractionTexts(
  threadIds: string[],
): Promise<Map<string, string>> {
  if (threadIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      threadId: extractionSources.emailThreadId,
      rawExtractionJson: extractionSources.rawExtractionJson,
    })
    .from(extractionSources)
    .where(inArray(extractionSources.emailThreadId, threadIds));

  const threadTexts = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.threadId) continue;
    const corpus = buildExtractionCorpus(row.rawExtractionJson);
    if (!corpus) continue;
    const bucket = threadTexts.get(row.threadId) ?? [];
    bucket.push(corpus);
    threadTexts.set(row.threadId, bucket);
  }

  return new Map(
    [...threadTexts.entries()].map(([threadId, bodies]) => [
      threadId,
      bodies.join("\n\n"),
    ]),
  );
}

async function readCachedAttachmentText(
  cachedFilePath: string,
  contentHash: string,
): Promise<string> {
  const sidecarPath = path.join(
    path.dirname(cachedFilePath),
    `${contentHash}.txt`,
  );

  try {
    await access(sidecarPath);
    return (await readFile(sidecarPath, "utf8")).trim();
  } catch {
    // Fall through to PDF extraction.
  }

  if (!cachedFilePath.toLowerCase().endsWith(".pdf")) return "";

  const bytes = await readFile(cachedFilePath);
  const text = await extractPdfText(bytes);
  if (text) {
    await writeFile(sidecarPath, text, "utf8");
  }
  return text;
}

async function loadThreadAttachmentTexts(
  threadIds: string[],
): Promise<Map<string, string>> {
  if (threadIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      threadId: emails.threadId,
      filename: emailAttachments.filename,
      cachedFilePath: emailAttachments.cachedFilePath,
      contentHash: emailAttachments.contentHash,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
    .where(inArray(emails.threadId, threadIds));

  const textByHash = new Map<string, string>();
  const threadTexts = new Map<string, string[]>();

  for (const row of rows) {
    if (!row.threadId || !row.cachedFilePath || !row.contentHash) continue;

    let attachmentText = textByHash.get(row.contentHash);
    if (attachmentText === undefined) {
      attachmentText = await readCachedAttachmentText(
        row.cachedFilePath,
        row.contentHash,
      );
      textByHash.set(row.contentHash, attachmentText);
    }
    if (!attachmentText) continue;

    const bucket = threadTexts.get(row.threadId) ?? [];
    bucket.push(`Attachment: ${row.filename}\n${attachmentText}`);
    threadTexts.set(row.threadId, bucket);
  }

  return new Map(
    [...threadTexts.entries()].map(([threadId, bodies]) => [
      threadId,
      bodies.join("\n\n---\n\n"),
    ]),
  );
}

async function loadThreadMetadata(
  threadIds: string[],
): Promise<Map<string, ThreadMetadata>> {
  if (threadIds.length === 0) return new Map();

  const db = getDb();
  const [subjectRows, summaryRows, attachmentRows] = await Promise.all([
    db
      .select({
        threadId: emails.threadId,
        subject: emails.subject,
      })
      .from(emails)
      .where(inArray(emails.threadId, threadIds))
      .orderBy(asc(emails.receivedAt)),
    db
      .select({
        threadId: extractionSources.emailThreadId,
        rawExtractionJson: extractionSources.rawExtractionJson,
      })
      .from(extractionSources)
      .where(inArray(extractionSources.emailThreadId, threadIds)),
    db
      .select({
        threadId: emails.threadId,
        filename: emailAttachments.filename,
      })
      .from(emailAttachments)
      .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
      .where(inArray(emails.threadId, threadIds)),
  ]);

  const metadata = new Map<string, ThreadMetadata>();

  for (const threadId of threadIds) {
    metadata.set(threadId, {
      subject: null,
      summaries: [],
      attachmentNames: [],
    });
  }

  for (const row of subjectRows) {
    if (!row.threadId) continue;
    const entry = metadata.get(row.threadId);
    if (!entry || entry.subject) continue;
    entry.subject = row.subject;
  }

  for (const row of summaryRows) {
    if (!row.threadId) continue;
    try {
      const doc = JSON.parse(row.rawExtractionJson) as { summary?: string };
      if (doc.summary?.trim()) {
        metadata.get(row.threadId)?.summaries.push(doc.summary.trim());
      }
    } catch {
      // Ignore malformed extraction JSON.
    }
  }

  for (const row of attachmentRows) {
    if (!row.threadId || !row.filename) continue;
    const entry = metadata.get(row.threadId);
    if (!entry || entry.attachmentNames.includes(row.filename)) continue;
    entry.attachmentNames.push(row.filename);
  }

  return metadata;
}

async function loadThreadEntityContexts(
  threadIds: string[],
): Promise<Map<string, ThreadEntityContext[]>> {
  if (threadIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      threadId: extractionSources.emailThreadId,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
    })
    .from(entityMentions)
    .innerJoin(
      extractionSources,
      eq(entityMentions.sourceId, extractionSources.id),
    )
    .where(inArray(extractionSources.emailThreadId, threadIds));

  const grouped = new Map<string, ThreadEntityContext[]>();
  for (const row of rows) {
    if (!row.threadId || !row.context?.trim()) continue;
    const bucket = grouped.get(row.threadId) ?? [];
    bucket.push({
      entityValue: row.entityValue,
      context: row.context.trim(),
    });
    grouped.set(row.threadId, bucket);
  }

  return grouped;
}

function buildThreadFraming(metadata: ThreadMetadata | undefined): string[] {
  if (!metadata) return [];

  const framing: string[] = [];
  if (metadata.subject?.trim()) {
    framing.push(`Thread: ${metadata.subject.trim()}`);
  }

  const summary = metadata.summaries.find((entry) => entry.trim());
  if (summary) {
    framing.push(`Summary: ${summary}`);
  }

  const attachment = metadata.attachmentNames[0];
  if (attachment) {
    framing.push(`Source attachment: ${attachment}`);
  }

  return framing;
}

function relatedContextsForGroup(
  group: EntityReviewGroup,
  storedContexts: string[],
  threadEntityContexts: ThreadEntityContext[],
): string[] {
  const entityValue =
    group.org?.value ?? group.person?.value ?? group.phone?.value ?? "";
  const hasTopic =
    storedContexts.some((context) => TOPIC_PATTERN.test(context)) ||
    threadEntityContexts.some((entry) => TOPIC_PATTERN.test(entry.context));

  if (!hasTopic) return [];

  return threadEntityContexts
    .filter(
      (entry) =>
        entry.entityValue !== entityValue &&
        entry.context !== storedContexts[0] &&
        TOPIC_PATTERN.test(entry.context),
    )
    .map((entry) => entry.context)
    .slice(0, 2);
}

function enrichGroupLinkContext(
  group: EntityReviewGroup,
  rowsById: Map<string, EntityMentionRow>,
  corpus: EnrichmentCorpus,
): EntityReviewGroup {
  const storedContexts = collectStoredContexts(group, rowsById);
  const searchTerms = collectEntitySearchTerms({
    personName: group.person?.value,
    orgName: group.org?.value ?? group.extractedOrgName,
    linkedOrgName: group.extractedOrgName,
    storedContexts,
  });

  const passages: string[] = [];
  const framing: string[] = [];
  const related: string[] = [];

  for (const threadId of threadIdsForGroup(
    group,
    rowsById,
    corpus.sourceThreadIds,
  )) {
    framing.push(...buildThreadFraming(corpus.threadMetadata.get(threadId)));

    for (const text of [
      corpus.threadTexts.get(threadId),
      corpus.threadExtractionTexts.get(threadId),
      corpus.threadAttachmentTexts.get(threadId),
    ]) {
      if (!text) continue;
      passages.push(...extractPassagesFromCorpus(text, searchTerms));
    }

    related.push(
      ...relatedContextsForGroup(
        group,
        storedContexts,
        corpus.threadEntityContexts.get(threadId) ?? [],
      ),
    );
  }

  const linkContext = composeLinkContext(
    [
      ...framing,
      ...passages,
      ...related.map((context) => `Related: ${context}`),
    ],
    { pinned: storedContexts },
  );

  if (!linkContext || linkContext === group.linkContext) return group;
  return { ...group, linkContext };
}

async function buildEnrichmentCorpus(
  threadIds: string[],
  sourceIds: string[],
): Promise<EnrichmentCorpus> {
  const [
    sourceThreadIds,
    threadTexts,
    threadExtractionTexts,
    threadAttachmentTexts,
    threadMetadata,
    threadEntityContexts,
  ] = await Promise.all([
    loadSourceThreadIds(sourceIds),
    loadThreadTexts(threadIds),
    loadThreadExtractionTexts(threadIds),
    loadThreadAttachmentTexts(threadIds),
    loadThreadMetadata(threadIds),
    loadThreadEntityContexts(threadIds),
  ]);

  return {
    sourceThreadIds,
    threadTexts,
    threadExtractionTexts,
    threadAttachmentTexts,
    threadMetadata,
    threadEntityContexts,
  };
}

export async function enrichEntityReviewGroupsWithThreadContext(
  groups: EntityReviewGroup[],
  mentionRows: EntityMentionRow[],
): Promise<EntityReviewGroup[]> {
  if (groups.length === 0) return groups;

  const rowsById = new Map(mentionRows.map((row) => [row.id, row]));
  const sourceIds = [
    ...new Set(
      mentionRows
        .map((row) => row.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId)),
    ),
  ];
  const sourceThreadIds = await loadSourceThreadIds(sourceIds);
  const threadIds = [
    ...new Set(
      [...sourceThreadIds.values()].filter(
        (threadId): threadId is string => Boolean(threadId),
      ),
    ),
  ];
  const corpus = await buildEnrichmentCorpus(threadIds, sourceIds);

  return groups.map((group) =>
    enrichGroupLinkContext(group, rowsById, corpus),
  );
}

/** Convenience helper when only mention ids are known (e.g. insights page). */
export async function enrichGroupsFromMentionIds(
  groups: EntityReviewGroup[],
  mentionIds: string[],
): Promise<EntityReviewGroup[]> {
  if (groups.length === 0 || mentionIds.length === 0) return groups;

  const db = getDb();
  const rows = await db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      reviewStatus: entityMentions.reviewStatus,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
      dedupKey: entityMentions.dedupKey,
      personTitle: entityMentions.personTitle,
      linkedOrganizationName: entityMentions.linkedOrganizationName,
      contactEmail: entityMentions.contactEmail,
      sourceId: entityMentions.sourceId,
    })
    .from(entityMentions)
    .where(inArray(entityMentions.id, mentionIds));

  return enrichEntityReviewGroupsWithThreadContext(
    groups,
    rows as EntityMentionRow[],
  );
}
