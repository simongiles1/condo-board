import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  projectFingerprintMerges,
  projectHighlightExtractions,
} from "@/lib/db/schema";
import {
  emptyProjectHighlightExtraction,
  mergeProjectHighlightExtractions,
  projectExtractionHasAny,
  parseProjectFingerprintResult,
  parseProjectHighlightExtraction,
  type ProjectEntityCard,
  type ProjectHighlightExtraction,
} from "@/lib/email-analysis/project-highlight-shared";
import {
  PROJECT_HIGHLIGHT_MODELS,
  type ProjectHighlightModelId,
} from "@/lib/email-analysis/project-highlight-models";

async function resolveMentionsForSourceEmails(
  emailIds: string[],
): Promise<void> {
  const ids = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  try {
    const { resolveProjectMentions } = await import(
      "@/lib/projects/mention-resolve"
    );
    await resolveProjectMentions({ emailIds: ids });
  } catch (error) {
    console.error("[project-mentions] resolve after persist failed", {
      error:
        error instanceof Error ? error.message : "Project mention resolve failed",
    });
  }
}

export function buildProjectFingerprintEmailIdsKey(emailIds: string[]): string {
  return [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ]
    .sort()
    .join(",");
}

export type PersistedProjectHighlightRow = {
  emailId: string;
  modelId: ProjectHighlightModelId;
  extraction: ProjectHighlightExtraction;
  skipped: boolean;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  apiModelName: string | null;
  updatedAt: string;
  secondPass: {
    extraction: ProjectHighlightExtraction;
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
    entityCards: ProjectEntityCard[];
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

export type ProjectHighlightPassRun = {
  extractions: Record<string, ProjectHighlightExtraction>;
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
      "project_name" | "year_hint" | "phase" | "contractor" | "location",
      number
    >;
  };
};

export type ProjectFingerprintPassRun = {
  entityCardsByEmailId: Record<string, ProjectEntityCard[]>;
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

export type ProjectFingerprintMergePassRun = {
  /** DB row id for this merge (null when nothing was persisted). */
  mergeId: string | null;
  entityCards: ProjectEntityCard[];
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

export type ProjectHighlightModelRun = ProjectHighlightPassRun & {
  secondPass: ProjectHighlightPassRun | null;
  thirdPass: ProjectFingerprintPassRun | null;
  fourthPass: ProjectFingerprintMergePassRun | null;
};

type SaveItem = {
  emailId: string;
  extraction: ProjectHighlightExtraction;
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
  extraction: ProjectHighlightExtraction;
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
  entityCards: ProjectEntityCard[];
  mentionCards?: ProjectEntityCard[];
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
  extractions: Record<string, ProjectHighlightExtraction>,
): ProjectHighlightPassRun["stats"]["typeCounts"] {
  const counts = {
    project_name: 0,
    year_hint: 0,
    phase: 0,
    contractor: 0,
    location: 0,
  };
  for (const extraction of Object.values(extractions)) {
    counts.project_name += extraction.project_names.length;
    counts.year_hint += extraction.year_hints.length;
    counts.phase += extraction.phases.length;
    counts.contractor += extraction.contractors.length;
    counts.location += extraction.locations.length;
  }
  return counts;
}

function buildPassRun(
  modelId: ProjectHighlightModelId,
  rows: Array<{
    emailId: string;
    extraction: ProjectHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): ProjectHighlightPassRun {
  const extractions: Record<string, ProjectHighlightExtraction> = {};
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
    else if (projectExtractionHasAny(row.extraction)) extracted += 1;
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
  modelId: ProjectHighlightModelId,
  rows: Array<{
    emailId: string;
    entityCards: ProjectEntityCard[];
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): ProjectFingerprintPassRun {
  const entityCardsByEmailId: Record<string, ProjectEntityCard[]> = {};
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
  modelId: ProjectHighlightModelId,
  rows: PersistedProjectHighlightRow[],
): ProjectHighlightModelRun {
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
  row: typeof projectHighlightExtractions.$inferSelect,
): PersistedProjectHighlightRow["secondPass"] {
  if (
    row.secondPassExtractionJson == null &&
    !row.secondPassError &&
    !row.secondPassUpdatedAt
  ) {
    return null;
  }

  let extraction = emptyProjectHighlightExtraction();
  if (row.secondPassExtractionJson) {
    try {
      extraction = parseProjectHighlightExtraction(
        JSON.parse(row.secondPassExtractionJson),
      );
    } catch {
      extraction = emptyProjectHighlightExtraction();
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
  row: typeof projectHighlightExtractions.$inferSelect,
): PersistedProjectHighlightRow["thirdPass"] {
  if (
    row.thirdPassExtractionJson == null &&
    !row.thirdPassError &&
    !row.thirdPassUpdatedAt
  ) {
    return null;
  }

  let entityCards: ProjectEntityCard[] = [];
  if (row.thirdPassExtractionJson) {
    try {
      entityCards = parseProjectFingerprintResult(
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
  run: ProjectHighlightModelRun,
  emailId: string,
): ProjectHighlightExtraction {
  const first = run.extractions[emailId] ?? emptyProjectHighlightExtraction();
  const second =
    run.secondPass?.extractions[emailId] ?? emptyProjectHighlightExtraction();
  return mergeProjectHighlightExtractions([first, second]);
}

export async function saveProjectHighlightExtractions(
  modelId: ProjectHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const extractionJson = JSON.stringify(
      item.extraction ?? emptyProjectHighlightExtraction(),
    );
    const inputTokens = item.usage?.inputTokens ?? null;
    const outputTokens = item.usage?.outputTokens ?? null;
    const totalTokens = item.usage?.totalTokens ?? null;
    const costUsd = item.costUsd != null ? String(item.costUsd) : null;

    const existing = await db
      .select({ id: projectHighlightExtractions.id })
      .from(projectHighlightExtractions)
      .where(
        and(
          eq(projectHighlightExtractions.emailId, emailId),
          eq(projectHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // First-pass overwrite invalidates any prior second/third pass.
      await db
        .update(projectHighlightExtractions)
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
        .where(eq(projectHighlightExtractions.id, existing[0].id));
    } else {
      await db.insert(projectHighlightExtractions).values({
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

  await deleteProjectFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveProjectHighlightSecondPass(
  modelId: ProjectHighlightModelId,
  items: SaveSecondPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: projectHighlightExtractions.id })
      .from(projectHighlightExtractions)
      .where(
        and(
          eq(projectHighlightExtractions.emailId, emailId),
          eq(projectHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      continue;
    }

    await db
      .update(projectHighlightExtractions)
      .set({
        secondPassExtractionJson: JSON.stringify(
          item.extraction ?? emptyProjectHighlightExtraction(),
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
      .where(eq(projectHighlightExtractions.id, existing[0].id));
  }

  await deleteProjectFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );
}

export async function saveProjectHighlightThirdPass(
  modelId: ProjectHighlightModelId,
  items: SaveThirdPassItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const existing = await db
      .select({ id: projectHighlightExtractions.id })
      .from(projectHighlightExtractions)
      .where(
        and(
          eq(projectHighlightExtractions.emailId, emailId),
          eq(projectHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      continue;
    }

    await db
      .update(projectHighlightExtractions)
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
      .where(eq(projectHighlightExtractions.id, existing[0].id));

    const { upsertProjectMentionsForEmail } = await import(
      "@/lib/projects/mention-persist"
    );
    await upsertProjectMentionsForEmail({
      sourceEmailId: emailId,
      entityCards: item.mentionCards ?? item.entityCards ?? [],
      modelId,
    });
    const { upsertPaintedOrgMentionSurfacesForEmail } = await import(
      "@/lib/organizations/mention-persist"
    );
    await upsertPaintedOrgMentionSurfacesForEmail(emailId);
  }

  await deleteProjectFingerprintMergesForEmails(
    modelId,
    items.map((item) => item.emailId),
  );

  // Match against current project_entities only. A full fingerprint rebuild
  // here (every pass-3 email × the whole registry) is what stuck Inbox
  // Re-harvest C+P on a 25-thread selection. Mint new entities with
  // Process pending project merges.
  const emailIds = items.map((item) => item.emailId);
  await resolveMentionsForSourceEmails(emailIds);
  const { resolveOrgMentions } = await import(
    "@/lib/organizations/mention-resolve"
  );
  await resolveOrgMentions({ emailIds });
}

export async function saveProjectFingerprintMerge(params: {
  modelId: ProjectHighlightModelId;
  emailIds: string[];
  entityCards: ProjectEntityCard[];
  inputCardCount: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
  error?: string | null;
}): Promise<ProjectFingerprintMergePassRun> {
  const emailIds = [
    ...new Set(params.emailIds.map((id) => id.trim()).filter(Boolean)),
  ].sort();
  const emailIdsKey = buildProjectFingerprintEmailIdsKey(emailIds);
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
    .select({ id: projectFingerprintMerges.id })
    .from(projectFingerprintMerges)
    .where(
      and(
        eq(projectFingerprintMerges.modelId, params.modelId),
        eq(projectFingerprintMerges.emailIdsKey, emailIdsKey),
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
      .update(projectFingerprintMerges)
      .set(values)
      .where(eq(projectFingerprintMerges.id, mergeId));
  } else {
    mergeId = randomUUID();
    await db.insert(projectFingerprintMerges).values({
      id: mergeId,
      modelId: params.modelId,
      emailIdsKey,
      ...values,
    });
  }

  await resolveMentionsForSourceEmails(params.emailIds);
  const { markProjectFingerprintSummariesStale } = await import(
    "@/lib/projects/fingerprint-list"
  );
  markProjectFingerprintSummariesStale();

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

export async function loadProjectHighlightRuns(
  emailIds: string[],
): Promise<Partial<Record<ProjectHighlightModelId, ProjectHighlightModelRun>>> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select()
    .from(projectHighlightExtractions)
    .where(inArray(projectHighlightExtractions.emailId, normalized));

  const byModel = new Map<ProjectHighlightModelId, PersistedProjectHighlightRow[]>();

  for (const row of rows) {
    if (!(PROJECT_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as ProjectHighlightModelId;
    const parsed: PersistedProjectHighlightRow = {
      emailId: row.emailId,
      modelId,
      extraction: parseProjectHighlightExtraction(JSON.parse(row.extractionJson)),
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

  const emailIdsKey = buildProjectFingerprintEmailIdsKey(normalized);
  const mergeRows = await db
    .select()
    .from(projectFingerprintMerges)
    .where(
      and(
        inArray(
          projectFingerprintMerges.modelId,
          [...byModel.keys()].length > 0
            ? [...byModel.keys()]
            : [...PROJECT_HIGHLIGHT_MODELS],
        ),
        eq(projectFingerprintMerges.emailIdsKey, emailIdsKey),
      ),
    );

  const mergeByModel = new Map<
    ProjectHighlightModelId,
    ProjectFingerprintMergePassRun
  >();
  for (const row of mergeRows) {
    if (!(PROJECT_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as ProjectHighlightModelId;
    let entityCards: ProjectEntityCard[] = [];
    try {
      entityCards = parseProjectFingerprintResult(
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

  const runs: Partial<Record<ProjectHighlightModelId, ProjectHighlightModelRun>> = {};
  for (const [modelId, modelRows] of byModel) {
    runs[modelId] = {
      ...buildModelRun(modelId, modelRows),
      fourthPass: mergeByModel.get(modelId) ?? null,
    };
  }
  return runs;
}

export async function deleteProjectFingerprintMergesForEmails(
  modelId: ProjectHighlightModelId,
  emailIds: string[],
): Promise<void> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  const rows = await db
    .select({
      id: projectFingerprintMerges.id,
      emailIdsJson: projectFingerprintMerges.emailIdsJson,
    })
    .from(projectFingerprintMerges)
    .where(eq(projectFingerprintMerges.modelId, modelId));

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
    .delete(projectFingerprintMerges)
    .where(inArray(projectFingerprintMerges.id, toDelete));
}

export async function deleteProjectHighlightExtractions(
  emailIds: string[],
  modelId: ProjectHighlightModelId,
): Promise<void> {
  const normalized = [...new Set(emailIds.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) return;

  const db = getDb();
  await db
    .delete(projectHighlightExtractions)
    .where(
      and(
        inArray(projectHighlightExtractions.emailId, normalized),
        eq(projectHighlightExtractions.modelId, modelId),
      ),
    );
  await deleteProjectFingerprintMergesForEmails(modelId, normalized);
}
