import { randomUUID } from "crypto";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  discoveredFacts,
  extractionSkillAuditLog,
  extractionSkillEntries,
  extractionSkillVersions,
} from "@/lib/db/schema";

import type {
  DiscoveredFactExtraction,
  ProposedNewConceptExtraction,
} from "./schema";

const DEFAULT_SKILL_TOKEN_BUDGET = 6000;
const EXAMPLE_LIMIT = 5;
const FUZZY_MERGE_THRESHOLD = 0.72;

export type SkillStatus = "active" | "archived" | "merged";

export type SkillEntry = {
  id: string;
  conceptName: string;
  description: string;
  suggestedFields: Array<{ name: string; type?: string; description?: string }>;
  exampleQuotes: string[];
  exampleEmailIds: string[];
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: SkillStatus;
  mergedIntoId: string | null;
  category: string | null;
  userNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompiledSkillPrompt = {
  skillVersionId: string;
  skillVersionNumber: number;
  promptSection: string;
  tokenEstimate: number;
  includedEntryCount: number;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueTrimmed(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenEstimate(value: string): number {
  return Math.ceil(value.length / 4);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${normalizeName(value)}  `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function similarity(a: string, b: string): number {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const aGrams = trigrams(normalizedA);
  const bGrams = trigrams(normalizedB);
  const intersection = [...aGrams].filter((gram) => bGrams.has(gram)).length;
  const union = new Set([...aGrams, ...bGrams]).size;
  return union ? intersection / union : 0;
}

function rowToEntry(row: typeof extractionSkillEntries.$inferSelect): SkillEntry {
  return {
    id: row.id,
    conceptName: row.conceptName,
    description: row.description,
    suggestedFields: parseJson(row.suggestedFieldsJson, []),
    exampleQuotes: parseJson(row.exampleQuotesJson, []),
    exampleEmailIds: parseJson(row.exampleEmailIdsJson, []),
    occurrenceCount: row.occurrenceCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    status: row.status,
    mergedIntoId: row.mergedIntoId,
    category: row.category,
    userNotes: row.userNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatEntry(entry: SkillEntry): string {
  const fields = entry.suggestedFields.length
    ? entry.suggestedFields
        .map((field) =>
          [field.name, field.type, field.description].filter(Boolean).join(": "),
        )
        .join("; ")
    : "free-form fields relevant to this concept";

  return [
    `- Concept: ${entry.conceptName}`,
    `  Description: ${entry.description}`,
    `  Suggested fields: ${fields}`,
    entry.exampleQuotes[0] ? `  Example quote: "${entry.exampleQuotes[0]}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function logSkillAction(input: {
  entryId?: string | null;
  action: string;
  details?: unknown;
}): Promise<void> {
  const db = getDb();
  await db.insert(extractionSkillAuditLog).values({
    id: randomUUID(),
    entryId: input.entryId ?? null,
    action: input.action,
    detailsJson: JSON.stringify(input.details ?? {}),
    createdAt: new Date().toISOString(),
  });
}

export async function getActiveSkillEntries(): Promise<SkillEntry[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(extractionSkillEntries)
    .where(eq(extractionSkillEntries.status, "active"))
    .orderBy(desc(extractionSkillEntries.occurrenceCount), asc(extractionSkillEntries.conceptName));

  return rows.map(rowToEntry);
}

export async function getAllSkillEntries(status?: SkillStatus): Promise<SkillEntry[]> {
  const db = getDb();
  const query = db.select().from(extractionSkillEntries);
  const rows = status
    ? await query
        .where(eq(extractionSkillEntries.status, status))
        .orderBy(desc(extractionSkillEntries.occurrenceCount), asc(extractionSkillEntries.conceptName))
    : await query.orderBy(
        desc(extractionSkillEntries.occurrenceCount),
        asc(extractionSkillEntries.conceptName),
      );

  return rows.map(rowToEntry);
}

async function getLatestSkillVersion() {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(extractionSkillVersions)
    .orderBy(desc(extractionSkillVersions.versionNumber))
    .limit(1);

  return latest;
}

export async function bumpSkillVersion(reason: string): Promise<{
  id: string;
  versionNumber: number;
}> {
  const db = getDb();
  const latest = await getLatestSkillVersion();
  const entries = await getActiveSkillEntries();
  const now = new Date().toISOString();
  const version = {
    id: randomUUID(),
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    snapshotJson: JSON.stringify({
      reason,
      entries,
      createdAt: now,
    }),
    createdAt: now,
  };

  await db.insert(extractionSkillVersions).values(version);
  await logSkillAction({
    action: "version_bumped",
    details: { reason, versionNumber: version.versionNumber },
  });

  return { id: version.id, versionNumber: version.versionNumber };
}

async function ensureSkillVersion(): Promise<{ id: string; versionNumber: number }> {
  const latest = await getLatestSkillVersion();
  if (latest) {
    return { id: latest.id, versionNumber: latest.versionNumber };
  }

  return bumpSkillVersion("initial_skill_version");
}

export async function archiveLowSignalEntries(input: {
  keepTopK: number;
  minOccurrence: number;
}): Promise<number> {
  const db = getDb();
  const active = await getActiveSkillEntries();
  const archive = active
    .slice(input.keepTopK)
    .filter((entry) => entry.occurrenceCount <= input.minOccurrence);

  if (!archive.length) return 0;

  const now = new Date().toISOString();
  await db
    .update(extractionSkillEntries)
    .set({ status: "archived", updatedAt: now })
    .where(
      inArray(
        extractionSkillEntries.id,
        archive.map((entry) => entry.id),
      ),
    );

  await logSkillAction({
    action: "archive_low_signal",
    details: {
      keepTopK: input.keepTopK,
      minOccurrence: input.minOccurrence,
      archivedIds: archive.map((entry) => entry.id),
    },
  });
  await bumpSkillVersion("archive_low_signal_entries");

  return archive.length;
}

export async function compileSkillPromptSection(input: {
  tokenBudget?: number;
} = {}): Promise<CompiledSkillPrompt> {
  const budget = input.tokenBudget ?? DEFAULT_SKILL_TOKEN_BUDGET;
  const entries = await getActiveSkillEntries();
  const version = await ensureSkillVersion();

  if (!entries.length) {
    return {
      ...version,
      skillVersionId: version.id,
      skillVersionNumber: version.versionNumber,
      promptSection: "",
      tokenEstimate: 0,
      includedEntryCount: 0,
    };
  }

  const header = `\n\nKNOWN EXTRACTION SKILL\nThese concepts were discovered in prior emails. If the current email explicitly mentions any concept below, add it to discovered_facts using concept_name exactly as written. Do not invent facts. Also propose genuinely new reusable concepts in proposed_new_concepts.\n\n`;
  const included: string[] = [];

  for (const entry of entries) {
    const candidate = [...included, formatEntry(entry)].join("\n\n");
    if (tokenEstimate(header + candidate) > budget) break;
    included.push(formatEntry(entry));
  }

  if (included.length < entries.length) {
    await archiveLowSignalEntries({ keepTopK: included.length, minOccurrence: 1 });
  }

  const promptSection = `${header}${included.join("\n\n")}`;

  return {
    ...version,
    skillVersionId: version.id,
    skillVersionNumber: version.versionNumber,
    promptSection,
    tokenEstimate: tokenEstimate(promptSection),
    includedEntryCount: included.length,
  };
}

async function findBestEntry(name: string): Promise<SkillEntry | null> {
  const entries = await getActiveSkillEntries();
  let best: { entry: SkillEntry; score: number } | null = null;

  for (const entry of entries) {
    const score = similarity(name, entry.conceptName);
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }

  return best && best.score >= FUZZY_MERGE_THRESHOLD ? best.entry : null;
}

async function createSkillEntry(input: {
  conceptName: string;
  description: string;
  suggestedFields?: Array<{ name: string; type?: string; description?: string }>;
  sourceQuote?: string;
  emailId?: string;
  category?: string;
}): Promise<SkillEntry> {
  const db = getDb();
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    conceptName: input.conceptName.trim(),
    description: input.description.trim() || input.conceptName.trim(),
    suggestedFieldsJson: JSON.stringify(input.suggestedFields ?? []),
    exampleQuotesJson: JSON.stringify(uniqueTrimmed([input.sourceQuote]).slice(0, EXAMPLE_LIMIT)),
    exampleEmailIdsJson: JSON.stringify(uniqueTrimmed([input.emailId]).slice(0, EXAMPLE_LIMIT)),
    occurrenceCount: input.sourceQuote ? 1 : 0,
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active" as const,
    mergedIntoId: null,
    category: input.category ?? null,
    userNotes: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(extractionSkillEntries).values(row);
  await logSkillAction({
    entryId: row.id,
    action: "created",
    details: { conceptName: row.conceptName },
  });
  await bumpSkillVersion(`created_skill_entry:${row.conceptName}`);

  return rowToEntry(row);
}

export async function ensureSkillEntry(input: {
  conceptName: string;
  description?: string;
  suggestedFields?: Array<{ name: string; type?: string; description?: string }>;
  sourceQuote?: string;
  emailId?: string;
}): Promise<SkillEntry> {
  const name = input.conceptName.trim();
  const existing = await findBestEntry(name);
  if (existing) return existing;

  return createSkillEntry({
    conceptName: name,
    description: input.description ?? name,
    suggestedFields: input.suggestedFields,
    sourceQuote: input.sourceQuote,
    emailId: input.emailId,
  });
}

async function recordOccurrence(input: {
  entry: SkillEntry;
  sourceQuote?: string;
  emailId?: string;
  suggestedFields?: Array<{ name: string; type?: string; description?: string }>;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const quotes = uniqueTrimmed([
    input.sourceQuote,
    ...input.entry.exampleQuotes,
  ]).slice(0, EXAMPLE_LIMIT);
  const emailIds = uniqueTrimmed([
    input.emailId,
    ...input.entry.exampleEmailIds,
  ]).slice(0, EXAMPLE_LIMIT);
  const suggestedFields =
    input.suggestedFields?.length && !input.entry.suggestedFields.length
      ? input.suggestedFields
      : input.entry.suggestedFields;

  await db
    .update(extractionSkillEntries)
    .set({
      occurrenceCount: sql`${extractionSkillEntries.occurrenceCount} + 1`,
      exampleQuotesJson: JSON.stringify(quotes),
      exampleEmailIdsJson: JSON.stringify(emailIds),
      suggestedFieldsJson: JSON.stringify(suggestedFields),
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(extractionSkillEntries.id, input.entry.id));
}

export async function mergeSkillProposals(input: {
  discoveredFacts?: DiscoveredFactExtraction[];
  proposedNewConcepts?: ProposedNewConceptExtraction[];
  emailId?: string;
  sourceId?: string;
}): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const fact of input.discoveredFacts ?? []) {
    const before = await findBestEntry(fact.concept_name);
    const entry =
      before ??
      (await createSkillEntry({
        conceptName: fact.concept_name,
        description: fact.concept_name,
        sourceQuote: fact.source_quote,
        emailId: input.emailId,
      }));

    if (!before) {
      created += 1;
    } else {
      await recordOccurrence({
        entry,
        sourceQuote: fact.source_quote,
        emailId: input.emailId,
      });
      updated += 1;
    }
  }

  for (const proposal of input.proposedNewConcepts ?? []) {
    const existing = await findBestEntry(proposal.name);
    if (existing) {
      await recordOccurrence({
        entry: existing,
        sourceQuote: proposal.source_quote,
        emailId: input.emailId,
        suggestedFields: proposal.suggested_fields,
      });
      await logSkillAction({
        entryId: existing.id,
        action: "proposal_merged",
        details: { proposedName: proposal.name, sourceId: input.sourceId },
      });
      updated += 1;
    } else {
      await createSkillEntry({
        conceptName: proposal.name,
        description: proposal.description,
        suggestedFields: proposal.suggested_fields,
        sourceQuote: proposal.source_quote,
        emailId: input.emailId,
      });
      created += 1;
    }
  }

  return { created, updated };
}

export async function persistDiscoveredFacts(input: {
  sourceId: string;
  emailId?: string;
  facts?: DiscoveredFactExtraction[];
}): Promise<number> {
  const db = getDb();
  let count = 0;

  for (const fact of input.facts ?? []) {
    const entry = await ensureSkillEntry({
      conceptName: fact.concept_name,
      sourceQuote: fact.source_quote,
      emailId: input.emailId,
    });
    const key = [
      entry.id,
      JSON.stringify(fact.fields ?? {}),
      fact.source_quote ?? "",
    ]
      .join("|")
      .toLowerCase();
    const existing = await db
      .select()
      .from(discoveredFacts)
      .where(eq(discoveredFacts.dedupKey, key))
      .limit(1);

    if (existing.length) continue;

    await db.insert(discoveredFacts).values({
      id: randomUUID(),
      conceptId: entry.id,
      payloadJson: JSON.stringify(fact.fields ?? {}),
      sourceQuote: fact.source_quote ?? null,
      confidence: fact.confidence ?? null,
      sourceId: input.sourceId,
      dedupKey: key,
      createdAt: new Date().toISOString(),
    });
    count += 1;
  }

  return count;
}
