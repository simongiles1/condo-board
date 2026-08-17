import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  organizationFingerprintMerges,
  organizationHighlightExtractions,
} from "@/lib/db/schema";
import {
  emptyOrgHighlightExtraction,
  mergeOrgHighlightExtractions,
  orgExtractionHasAny,
  parseOrgFingerprintResult,
  parseOrgHighlightExtraction,
  type OrgEntityCard,
  type OrgHighlightExtraction,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  ORG_HIGHLIGHT_MODELS,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";

export function buildOrgFingerprintEmailIdsKey(emailIds: string[]): string {
  return [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ]
    .sort()
    .join(",");
}

export type PersistedOrgHighlightRow = {
  emailId: string;
  modelId: OrgHighlightModelId;
  extraction: OrgHighlightExtraction;
  skipped: boolean;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  apiModelName: string | null;
  updatedAt: string;
  secondPass: {
    extraction: OrgHighlightExtraction;
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
    entityCards: OrgEntityCard[];
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

export type OrgHighlightPassRun = {
  extractions: Record<string, OrgHighlightExtraction>;
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
      "organization_name" | "phone" | "organization_role" | "website",
      number
    >;
  };
};

export type OrgFingerprintPassRun = {
  entityCardsByEmailId: Record<string, OrgEntityCard[]>;
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

export type OrgFingerprintMergePassRun = {
  /** DB row id for this merge (null when nothing was persisted). */
  mergeId: string | null;
  entityCards: OrgEntityCard[];
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

export type OrgHighlightModelRun = OrgHighlightPassRun & {
  secondPass: OrgHighlightPassRun | null;
  thirdPass: OrgFingerprintPassRun | null;
  fourthPass: OrgFingerprintMergePassRun | null;
};

type SaveItem = {
  emailId: string;
  extraction: OrgHighlightExtraction;
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
  extraction: OrgHighlightExtraction;
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
  entityCards: OrgEntityCard[];
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
  extractions: Record<string, OrgHighlightExtraction>,
): OrgHighlightPassRun["stats"]["typeCounts"] {
  const counts = {
    organization_name: 0,
    phone: 0,
    organization_role: 0,
    website: 0,
  };
  for (const extraction of Object.values(extractions)) {
    counts.organization_name += extraction.organization_names.length;
    counts.phone += extraction.phones.length;
    counts.organization_role += extraction.organization_roles.length;
    counts.website += extraction.websites.length;
  }
  return counts;
}

function buildPassRun(
  modelId: OrgHighlightModelId,
  rows: Array<{
    emailId: string;
    extraction: OrgHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): OrgHighlightPassRun {
  const extractions: Record<string, OrgHighlightExtraction> = {};
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
    else if (orgExtractionHasAny(row.extraction)) extracted += 1;
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
  modelId: OrgHighlightModelId,
  rows: Array<{
    emailId: string;
    entityCards: OrgEntityCard[];
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): OrgFingerprintPassRun {
  const entityCardsByEmailId: Record<string, OrgEntityCard[]> = {};
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
  modelId: OrgHighlightModelId,
  rows: PersistedOrgHighlightRow[],
): OrgHighlightModelRun {
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
  row: typeof organizationHighlightExtractions.$inferSelect,
): PersistedOrgHighlightRow["secondPass"] {
  if (
    row.secondPassExtractionJson == null &&
    !row.secondPassError &&
    !row.secondPassUpdatedAt
  ) {
    return null;
  }

  let extraction = emptyOrgHighlightExtraction();
  if (row.secondPassExtractionJson) {
    try {
      extraction = parseOrgHighlightExtraction(
        JSON.parse(row.secondPassExtractionJson),
      );
    } catch {
      extraction = emptyOrgHighlightExtraction();
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
  row: typeof organizationHighlightExtractions.$inferSelect,
): PersistedOrgHighlightRow["thirdPass"] {
  if (
    row.thirdPassExtractionJson == null &&
    !row.thirdPassError &&
    !row.thirdPassUpdatedAt
  ) {
    return null;
  }

  let entityCards: OrgEntityCard[] = [];
  if (row.thirdPassExtractionJson) {
    try {
      entityCards = parseOrgFingerprintResult(
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
  run: OrgHighlightModelRun,
  emailId: string,
): OrgHighlightExtraction {
  const first = run.extractions[emailId] ?? emptyOrgHighlightExtraction();
  const second =
    run.secondPass?.extractions[emailId] ?? emptyOrgHighlightExtraction();
  return mergeOrgHighlightExtractions([first, second]);
}

export async function saveOrgHighlightExtractions(
  modelId: OrgHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const extractionJson = JSON.stringify(
      item.extraction ?? emptyOrgHighlightExtraction(),
    );
    const inputTokens = item.usage?.inputTokens ?? null;
    const outputTokens = item.usage?.outputTokens ?? null;
    const totalTokens = item.usage?.totalTokens ?? null;
    const costUsd = item.costUsd != null ? String(item.costUsd) : null;

    const existing = await db
      .select({ id: organizationHighlightExtractions.id })
      .from(organizationHighlightExtractions)
      .where(
        and(
          eq(organizationHighlightExtractions.emailId, emailId),
          eq(organizationHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // First-pass overwrite invalidates any prior second/third pass.
      await db
        .update(organizationHighlightExtractions)
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
        .where(eq(organizationHighlightExtractions.id, existing[0].id));
    } else {
      await db.insert(organizationHighlightExtractions).values({
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

  await deleteOrgFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveOrgHighlightSecondPass(
  modelId: OrgHighlightModelId,
  items: SaveSecondPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: organizationHighlightExtractions.id })
      .from(organizationHighlightExtractions)
      .where(
        and(
          eq(organizationHighlightExtractions.emailId, emailId),
          eq(organizationHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      continue;
    }

    await db
      .update(organizationHighlightExtractions)
      .set({
        secondPassExtractionJson: JSON.stringify(
          item.extraction ?? emptyOrgHighlightExtraction(),
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
      .where(eq(organizationHighlightExtractions.id, existing[0].id));
  }

  await deleteOrgFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveOrgHighlightThirdPass(
  modelId: OrgHighlightModelId,
  items: SaveThirdPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: organizationHighlightExtractions.id })
      .from(organizationHighlightExtractions)
      .where(
        and(
          eq(organizationHighlightExtractions.emailId, emailId),
          eq(organizationHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      continue;
    }

    await db
      .update(organizationHighlightExtractions)
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
      .where(eq(organizationHighlightExtractions.id, existing[0].id));
  }

  await deleteOrgFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveOrgFingerprintMerge(params: {
  modelId: OrgHighlightModelId;
  emailIds: string[];
  entityCards: OrgEntityCard[];
  inputCardCount: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
  error?: string | null;
}): Promise<OrgFingerprintMergePassRun> {
  const emailIds = [
    ...new Set(params.emailIds.map((id) => id.trim()).filter(Boolean)),
  ].sort();
  const emailIdsKey = buildOrgFingerprintEmailIdsKey(emailIds);
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
    .select({ id: organizationFingerprintMerges.id })
    .from(organizationFingerprintMerges)
    .where(
      and(
        eq(organizationFingerprintMerges.modelId, params.modelId),
        eq(organizationFingerprintMerges.emailIdsKey, emailIdsKey),
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
      .update(organizationFingerprintMerges)
      .set(values)
      .where(eq(organizationFingerprintMerges.id, mergeId));
  } else {
    mergeId = randomUUID();
    await db.insert(organizationFingerprintMerges).values({
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

export async function loadOrgHighlightRuns(
  emailIds: string[],
): Promise<Partial<Record<OrgHighlightModelId, OrgHighlightModelRun>>> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select()
    .from(organizationHighlightExtractions)
    .where(inArray(organizationHighlightExtractions.emailId, normalized));

  const byModel = new Map<OrgHighlightModelId, PersistedOrgHighlightRow[]>();

  for (const row of rows) {
    if (!(ORG_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as OrgHighlightModelId;
    const parsed: PersistedOrgHighlightRow = {
      emailId: row.emailId,
      modelId,
      extraction: parseOrgHighlightExtraction(JSON.parse(row.extractionJson)),
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

  const emailIdsKey = buildOrgFingerprintEmailIdsKey(normalized);
  const mergeRows = await db
    .select()
    .from(organizationFingerprintMerges)
    .where(
      and(
        inArray(
          organizationFingerprintMerges.modelId,
          [...byModel.keys()].length > 0
            ? [...byModel.keys()]
            : [...ORG_HIGHLIGHT_MODELS],
        ),
        eq(organizationFingerprintMerges.emailIdsKey, emailIdsKey),
      ),
    );

  const mergeByModel = new Map<
    OrgHighlightModelId,
    OrgFingerprintMergePassRun
  >();
  for (const row of mergeRows) {
    if (!(ORG_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as OrgHighlightModelId;
    let entityCards: OrgEntityCard[] = [];
    try {
      entityCards = parseOrgFingerprintResult(
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

  const runs: Partial<Record<OrgHighlightModelId, OrgHighlightModelRun>> = {};
  for (const [modelId, modelRows] of byModel) {
    runs[modelId] = {
      ...buildModelRun(modelId, modelRows),
      fourthPass: mergeByModel.get(modelId) ?? null,
    };
  }
  return runs;
}

export async function deleteOrgFingerprintMergesForEmails(
  modelId: OrgHighlightModelId,
  emailIds: string[],
): Promise<void> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  const rows = await db
    .select({
      id: organizationFingerprintMerges.id,
      emailIdsJson: organizationFingerprintMerges.emailIdsJson,
    })
    .from(organizationFingerprintMerges)
    .where(eq(organizationFingerprintMerges.modelId, modelId));

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
    .delete(organizationFingerprintMerges)
    .where(inArray(organizationFingerprintMerges.id, toDelete));
}

export async function deleteOrgHighlightExtractions(
  emailIds: string[],
  modelId: OrgHighlightModelId,
): Promise<void> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return;

  const db = getDb();
  await db
    .delete(organizationHighlightExtractions)
    .where(
      and(
        inArray(organizationHighlightExtractions.emailId, normalized),
        eq(organizationHighlightExtractions.modelId, modelId),
      ),
    );
  await deleteOrgFingerprintMergesForEmails(modelId, normalized);
}
