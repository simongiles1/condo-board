import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactFingerprintMerges,
  contactHighlightExtractions,
} from "@/lib/db/schema";
import {
  emptyContactHighlightExtraction,
  extractionHasAny,
  mergeContactHighlightExtractions,
  parseContactFingerprintResult,
  parseContactHighlightExtraction,
  type ContactEntityCard,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  CONTACT_HIGHLIGHT_MODELS,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";

export function buildContactFingerprintEmailIdsKey(emailIds: string[]): string {
  return [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ]
    .sort()
    .join(",");
}

export type PersistedContactHighlightRow = {
  emailId: string;
  modelId: ContactHighlightModelId;
  extraction: ContactHighlightExtraction;
  skipped: boolean;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  apiModelName: string | null;
  updatedAt: string;
  secondPass: {
    extraction: ContactHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
    updatedAt: string;
  } | null;
  thirdPass: {
    entityCards: ContactEntityCard[];
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
    updatedAt: string;
  } | null;
};

export type ContactHighlightPassRun = {
  extractions: Record<string, ContactHighlightExtraction>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
  };
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: Record<
      "contact_name" | "phone" | "job_title" | "company_name",
      number
    >;
  };
};

export type ContactFingerprintPassRun = {
  entityCardsByEmailId: Record<string, ContactEntityCard[]>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
  };
  stats: {
    cardCount: number;
    emailsWithCards: number;
    skipped: number;
    failed: number;
  };
};

export type ContactFingerprintMergePassRun = {
  /** DB row id for this merge (null when nothing was persisted). */
  mergeId: string | null;
  entityCards: ContactEntityCard[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
  };
  stats: {
    cardCount: number;
    inputCardCount: number;
  };
  error: string | null;
};

export type ContactHighlightModelRun = ContactHighlightPassRun & {
  secondPass: ContactHighlightPassRun | null;
  thirdPass: ContactFingerprintPassRun | null;
  fourthPass: ContactFingerprintMergePassRun | null;
};

type SaveItem = {
  emailId: string;
  extraction: ContactHighlightExtraction;
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

type SaveSecondPassItem = {
  emailId: string;
  extraction: ContactHighlightExtraction;
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

type SaveThirdPassItem = {
  emailId: string;
  entityCards: ContactEntityCard[];
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

const CLEARED_SECOND_PASS = {
  secondPassExtractionJson: null,
  secondPassSkipped: false,
  secondPassError: null,
  secondPassInputTokens: null,
  secondPassOutputTokens: null,
  secondPassTotalTokens: null,
  secondPassCostUsd: null,
  secondPassApiModelName: null,
  secondPassUpdatedAt: null,
} as const;

const CLEARED_THIRD_PASS = {
  thirdPassExtractionJson: null,
  thirdPassSkipped: false,
  thirdPassError: null,
  thirdPassInputTokens: null,
  thirdPassOutputTokens: null,
  thirdPassTotalTokens: null,
  thirdPassCostUsd: null,
  thirdPassApiModelName: null,
  thirdPassUpdatedAt: null,
} as const;

function countExtractionTypes(
  extractions: Record<string, ContactHighlightExtraction>,
): ContactHighlightPassRun["stats"]["typeCounts"] {
  const counts = {
    contact_name: 0,
    phone: 0,
    job_title: 0,
    company_name: 0,
  };
  for (const extraction of Object.values(extractions)) {
    counts.contact_name += extraction.contact_names.length;
    counts.phone += extraction.phones.length;
    counts.job_title += extraction.job_titles.length;
    counts.company_name += extraction.company_names.length;
  }
  return counts;
}

function buildPassRun(
  modelId: ContactHighlightModelId,
  rows: Array<{
    emailId: string;
    extraction: ContactHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): ContactHighlightPassRun {
  const extractions: Record<string, ContactHighlightExtraction> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let apiModelName: string = modelId;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    extractions[row.emailId] = row.extraction;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    totalTokens += row.totalTokens;
    costUsd += row.costUsd;
    if (row.apiModelName) apiModelName = row.apiModelName;
    if (row.error) failed += 1;
    else if (row.skipped) skipped += 1;
    else if (extractionHasAny(row.extraction)) extracted += 1;
    else skipped += 1;
  }

  return {
    extractions,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      modelName: apiModelName,
    },
    stats: {
      extracted,
      skipped,
      failed,
      typeCounts: countExtractionTypes(extractions),
    },
  };
}

function buildFingerprintPassRun(
  modelId: ContactHighlightModelId,
  rows: Array<{
    emailId: string;
    entityCards: ContactEntityCard[];
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): ContactFingerprintPassRun {
  const entityCardsByEmailId: Record<string, ContactEntityCard[]> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let apiModelName: string = modelId;
  let cardCount = 0;
  let emailsWithCards = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    entityCardsByEmailId[row.emailId] = row.entityCards;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    totalTokens += row.totalTokens;
    costUsd += row.costUsd;
    if (row.apiModelName) apiModelName = row.apiModelName;
    cardCount += row.entityCards.length;
    if (row.error) failed += 1;
    else if (row.skipped) skipped += 1;
    else if (row.entityCards.length > 0) emailsWithCards += 1;
    else skipped += 1;
  }

  return {
    entityCardsByEmailId,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      modelName: apiModelName,
    },
    stats: {
      cardCount,
      emailsWithCards,
      skipped,
      failed,
    },
  };
}

function buildModelRun(
  modelId: ContactHighlightModelId,
  rows: PersistedContactHighlightRow[],
): ContactHighlightModelRun {
  const firstPass = buildPassRun(
    modelId,
    rows.map((row) => ({
      emailId: row.emailId,
      extraction: row.extraction,
      skipped: row.skipped,
      error: row.error,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      apiModelName: row.apiModelName,
    })),
  );

  const secondPassRows = rows
    .filter((row) => row.secondPass != null)
    .map((row) => ({
      emailId: row.emailId,
      extraction: row.secondPass!.extraction,
      skipped: row.secondPass!.skipped,
      error: row.secondPass!.error,
      inputTokens: row.secondPass!.inputTokens,
      outputTokens: row.secondPass!.outputTokens,
      totalTokens: row.secondPass!.totalTokens,
      costUsd: row.secondPass!.costUsd,
      apiModelName: row.secondPass!.apiModelName,
    }));

  const thirdPassRows = rows
    .filter((row) => row.thirdPass != null)
    .map((row) => ({
      emailId: row.emailId,
      entityCards: row.thirdPass!.entityCards,
      skipped: row.thirdPass!.skipped,
      error: row.thirdPass!.error,
      inputTokens: row.thirdPass!.inputTokens,
      outputTokens: row.thirdPass!.outputTokens,
      totalTokens: row.thirdPass!.totalTokens,
      costUsd: row.thirdPass!.costUsd,
      apiModelName: row.thirdPass!.apiModelName,
    }));

  return {
    ...firstPass,
    secondPass:
      secondPassRows.length > 0 ? buildPassRun(modelId, secondPassRows) : null,
    thirdPass:
      thirdPassRows.length > 0
        ? buildFingerprintPassRun(modelId, thirdPassRows)
        : null,
    fourthPass: null,
  };
}

function parseSecondPass(
  row: typeof contactHighlightExtractions.$inferSelect,
): PersistedContactHighlightRow["secondPass"] {
  if (
    row.secondPassExtractionJson == null &&
    !row.secondPassError &&
    !row.secondPassUpdatedAt
  ) {
    return null;
  }

  let extraction = emptyContactHighlightExtraction();
  if (row.secondPassExtractionJson) {
    try {
      extraction = parseContactHighlightExtraction(
        JSON.parse(row.secondPassExtractionJson),
      );
    } catch {
      extraction = emptyContactHighlightExtraction();
    }
  }

  return {
    extraction,
    skipped: row.secondPassSkipped,
    error: row.secondPassError,
    inputTokens: row.secondPassInputTokens ?? 0,
    outputTokens: row.secondPassOutputTokens ?? 0,
    totalTokens: row.secondPassTotalTokens ?? 0,
    costUsd: row.secondPassCostUsd ? Number(row.secondPassCostUsd) : 0,
    apiModelName: row.secondPassApiModelName,
    updatedAt: row.secondPassUpdatedAt ?? row.updatedAt,
  };
}

function parseThirdPass(
  row: typeof contactHighlightExtractions.$inferSelect,
): PersistedContactHighlightRow["thirdPass"] {
  if (
    row.thirdPassExtractionJson == null &&
    !row.thirdPassError &&
    !row.thirdPassUpdatedAt
  ) {
    return null;
  }

  let entityCards: ContactEntityCard[] = [];
  if (row.thirdPassExtractionJson) {
    try {
      entityCards = parseContactFingerprintResult(
        JSON.parse(row.thirdPassExtractionJson),
      ).entity_cards;
    } catch {
      entityCards = [];
    }
  }

  return {
    entityCards,
    skipped: row.thirdPassSkipped,
    error: row.thirdPassError,
    inputTokens: row.thirdPassInputTokens ?? 0,
    outputTokens: row.thirdPassOutputTokens ?? 0,
    totalTokens: row.thirdPassTotalTokens ?? 0,
    costUsd: row.thirdPassCostUsd ? Number(row.thirdPassCostUsd) : 0,
    apiModelName: row.thirdPassApiModelName,
    updatedAt: row.thirdPassUpdatedAt ?? row.updatedAt,
  };
}

/** Merged pass-1 + pass-2 finds for fingerprinting. */
export function mergedPriorExtractionsForEmail(
  run: ContactHighlightModelRun,
  emailId: string,
): ContactHighlightExtraction {
  const first =
    run.extractions[emailId] ?? emptyContactHighlightExtraction();
  const second =
    run.secondPass?.extractions[emailId] ?? emptyContactHighlightExtraction();
  return mergeContactHighlightExtractions([first, second]);
}

export async function saveContactHighlightExtractions(
  modelId: ContactHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const extractionJson = JSON.stringify(
      item.extraction ?? emptyContactHighlightExtraction(),
    );
    const inputTokens = item.usage?.inputTokens ?? null;
    const outputTokens = item.usage?.outputTokens ?? null;
    const totalTokens = item.usage?.totalTokens ?? null;
    const costUsd =
      item.costUsd != null ? String(item.costUsd) : null;

    const existing = await db
      .select({ id: contactHighlightExtractions.id })
      .from(contactHighlightExtractions)
      .where(
        and(
          eq(contactHighlightExtractions.emailId, emailId),
          eq(contactHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // First-pass overwrite invalidates any prior second/third pass.
      await db
        .update(contactHighlightExtractions)
        .set({
          extractionJson,
          skipped: Boolean(item.skipped),
          error: item.error ?? null,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd,
          apiModelName: item.modelName ?? null,
          updatedAt: now,
          ...CLEARED_SECOND_PASS,
          ...CLEARED_THIRD_PASS,
        })
        .where(eq(contactHighlightExtractions.id, existing[0].id));
    } else {
      await db.insert(contactHighlightExtractions).values({
        id: randomUUID(),
        emailId,
        modelId,
        extractionJson,
        skipped: Boolean(item.skipped),
        error: item.error ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        apiModelName: item.modelName ?? null,
        updatedAt: now,
      });
    }
  }

  await deleteContactFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveContactHighlightSecondPass(
  modelId: ContactHighlightModelId,
  items: SaveSecondPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: contactHighlightExtractions.id })
      .from(contactHighlightExtractions)
      .where(
        and(
          eq(contactHighlightExtractions.emailId, emailId),
          eq(contactHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      // First pass must exist before second pass can be saved.
      continue;
    }

    // Second-pass overwrite invalidates fingerprints (depend on merged finds).
    await db
      .update(contactHighlightExtractions)
      .set({
        secondPassExtractionJson: JSON.stringify(
          item.extraction ?? emptyContactHighlightExtraction(),
        ),
        secondPassSkipped: Boolean(item.skipped),
        secondPassError: item.error ?? null,
        secondPassInputTokens: item.usage?.inputTokens ?? null,
        secondPassOutputTokens: item.usage?.outputTokens ?? null,
        secondPassTotalTokens: item.usage?.totalTokens ?? null,
        secondPassCostUsd:
          item.costUsd != null ? String(item.costUsd) : null,
        secondPassApiModelName: item.modelName ?? null,
        secondPassUpdatedAt: now,
        ...CLEARED_THIRD_PASS,
      })
      .where(eq(contactHighlightExtractions.id, existing[0].id));
  }

  await deleteContactFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveContactHighlightThirdPass(
  modelId: ContactHighlightModelId,
  items: SaveThirdPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: contactHighlightExtractions.id })
      .from(contactHighlightExtractions)
      .where(
        and(
          eq(contactHighlightExtractions.emailId, emailId),
          eq(contactHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      continue;
    }

    await db
      .update(contactHighlightExtractions)
      .set({
        thirdPassExtractionJson: JSON.stringify({
          entity_cards: item.entityCards ?? [],
        }),
        thirdPassSkipped: Boolean(item.skipped),
        thirdPassError: item.error ?? null,
        thirdPassInputTokens: item.usage?.inputTokens ?? null,
        thirdPassOutputTokens: item.usage?.outputTokens ?? null,
        thirdPassTotalTokens: item.usage?.totalTokens ?? null,
        thirdPassCostUsd:
          item.costUsd != null ? String(item.costUsd) : null,
        thirdPassApiModelName: item.modelName ?? null,
        thirdPassUpdatedAt: now,
      })
      .where(eq(contactHighlightExtractions.id, existing[0].id));
  }

  // Re-running fingerprints invalidates any prior merge for these emails.
  await deleteContactFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveContactFingerprintMerge(params: {
  modelId: ContactHighlightModelId;
  emailIds: string[];
  entityCards: ContactEntityCard[];
  inputCardCount: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
  error?: string | null;
}): Promise<ContactFingerprintMergePassRun> {
  const emailIds = [
    ...new Set(params.emailIds.map((id) => id.trim()).filter(Boolean)),
  ].sort();
  const emailIdsKey = buildContactFingerprintEmailIdsKey(emailIds);
  if (!emailIdsKey) {
    return {
      mergeId: null,
      entityCards: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        modelName: params.modelId,
      },
      stats: { cardCount: 0, inputCardCount: 0 },
      error: null,
    };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const entityCards = params.entityCards ?? [];
  const usage = {
    inputTokens: params.usage?.inputTokens ?? 0,
    outputTokens: params.usage?.outputTokens ?? 0,
    totalTokens: params.usage?.totalTokens ?? 0,
    costUsd: params.costUsd ?? 0,
    modelName: params.modelName ?? params.modelId,
  };

  const existing = await db
    .select({ id: contactFingerprintMerges.id })
    .from(contactFingerprintMerges)
    .where(
      and(
        eq(contactFingerprintMerges.modelId, params.modelId),
        eq(contactFingerprintMerges.emailIdsKey, emailIdsKey),
      ),
    )
    .limit(1);

  const values = {
    entityCardsJson: JSON.stringify({ entity_cards: entityCards }),
    emailIdsJson: JSON.stringify(emailIds),
    inputTokens: params.usage?.inputTokens ?? null,
    outputTokens: params.usage?.outputTokens ?? null,
    totalTokens: params.usage?.totalTokens ?? null,
    costUsd: params.costUsd != null ? String(params.costUsd) : null,
    apiModelName: params.modelName ?? null,
    error: params.error ?? null,
    updatedAt: now,
  };

  let mergeId: string;
  if (existing[0]) {
    mergeId = existing[0].id;
    await db
      .update(contactFingerprintMerges)
      .set(values)
      .where(eq(contactFingerprintMerges.id, mergeId));
  } else {
    mergeId = randomUUID();
    await db.insert(contactFingerprintMerges).values({
      id: mergeId,
      modelId: params.modelId,
      emailIdsKey,
      ...values,
    });
  }

  return {
    mergeId,
    entityCards,
    usage,
    stats: {
      cardCount: entityCards.length,
      inputCardCount: params.inputCardCount,
    },
    error: params.error ?? null,
  };
}

export async function loadContactHighlightRuns(
  emailIds: string[],
): Promise<Partial<Record<ContactHighlightModelId, ContactHighlightModelRun>>> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select()
    .from(contactHighlightExtractions)
    .where(inArray(contactHighlightExtractions.emailId, normalized));

  const byModel = new Map<ContactHighlightModelId, PersistedContactHighlightRow[]>();

  for (const row of rows) {
    if (!(CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as ContactHighlightModelId;
    const parsed: PersistedContactHighlightRow = {
      emailId: row.emailId,
      modelId,
      extraction: parseContactHighlightExtraction(
        JSON.parse(row.extractionJson),
      ),
      skipped: row.skipped,
      error: row.error,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      totalTokens: row.totalTokens ?? 0,
      costUsd: row.costUsd ? Number(row.costUsd) : 0,
      apiModelName: row.apiModelName,
      updatedAt: row.updatedAt,
      secondPass: parseSecondPass(row),
      thirdPass: parseThirdPass(row),
    };
    const bucket = byModel.get(modelId) ?? [];
    bucket.push(parsed);
    byModel.set(modelId, bucket);
  }

  const emailIdsKey = buildContactFingerprintEmailIdsKey(normalized);
  const mergeRows = await db
    .select()
    .from(contactFingerprintMerges)
    .where(
      and(
        inArray(
          contactFingerprintMerges.modelId,
          [...byModel.keys()].length > 0
            ? [...byModel.keys()]
            : [...CONTACT_HIGHLIGHT_MODELS],
        ),
        eq(contactFingerprintMerges.emailIdsKey, emailIdsKey),
      ),
    );

  const mergeByModel = new Map<
    ContactHighlightModelId,
    ContactFingerprintMergePassRun
  >();
  for (const row of mergeRows) {
    if (!(CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as ContactHighlightModelId;
    let entityCards: ContactEntityCard[] = [];
    try {
      entityCards = parseContactFingerprintResult(
        JSON.parse(row.entityCardsJson),
      ).entity_cards;
    } catch {
      entityCards = [];
    }
    mergeByModel.set(modelId, {
      mergeId: row.id,
      entityCards,
      usage: {
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        totalTokens: row.totalTokens ?? 0,
        costUsd: row.costUsd ? Number(row.costUsd) : 0,
        modelName: row.apiModelName ?? modelId,
      },
      stats: {
        cardCount: entityCards.length,
        inputCardCount: 0,
      },
      error: row.error,
    });
  }

  const runs: Partial<Record<ContactHighlightModelId, ContactHighlightModelRun>> =
    {};
  for (const [modelId, modelRows] of byModel) {
    runs[modelId] = {
      ...buildModelRun(modelId, modelRows),
      fourthPass: mergeByModel.get(modelId) ?? null,
    };
  }
  return runs;
}

/**
 * Delete merges for a model whose email set intersects any of the given ids.
 * (Stored key is the full set; we match by LIKE on individual ids for safety.)
 */
export async function deleteContactFingerprintMergesForEmails(
  modelId: ContactHighlightModelId,
  emailIds: string[],
): Promise<void> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  const rows = await db
    .select({
      id: contactFingerprintMerges.id,
      emailIdsJson: contactFingerprintMerges.emailIdsJson,
    })
    .from(contactFingerprintMerges)
    .where(eq(contactFingerprintMerges.modelId, modelId));

  const toDelete: string[] = [];
  const touched = new Set(normalized);
  for (const row of rows) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(row.emailIdsJson) as unknown;
      ids = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      ids = [];
    }
    if (ids.some((id) => touched.has(id))) {
      toDelete.push(row.id);
    }
  }

  if (toDelete.length === 0) return;
  await db
    .delete(contactFingerprintMerges)
    .where(inArray(contactFingerprintMerges.id, toDelete));
}

export async function deleteContactHighlightExtractions(
  emailIds: string[],
  modelId: ContactHighlightModelId,
): Promise<void> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return;

  const db = getDb();
  await db
    .delete(contactHighlightExtractions)
    .where(
      and(
        inArray(contactHighlightExtractions.emailId, normalized),
        eq(contactHighlightExtractions.modelId, modelId),
      ),
    );
  await deleteContactFingerprintMergesForEmails(modelId, normalized);
}
