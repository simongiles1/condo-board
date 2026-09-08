import { randomUUID } from "crypto";
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  buildingEquipmentRegistry,
  equipmentMentions,
} from "@/lib/db/schema";
import {
  decideEquipmentMentionResolution,
  type EquipmentMentionQuery,
  type EquipmentRegistryDocument,
  type EquipmentResolveDecision,
} from "./mention-resolve-shared";

export type EquipmentMentionStats = {
  total: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
};

export type EquipmentMentionRow = {
  id: string;
  sourceEmailId: string | null;
  rawName: string;
  extractedRole: string | null;
  parentSystemHint: string | null;
  category: string | null;
  resolvedEquipmentId: string | null;
  resolutionStatus: "confirmed" | "provisional" | "unresolved";
  resolutionReason: string | null;
  confidence: string | null;
  sourceQuote: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // fallback
  }
  return [];
}

/**
 * Load all equipment registry assets as search documents.
 */
export async function loadActiveEquipmentRegistryDocuments(): Promise<
  EquipmentRegistryDocument[]
> {
  const db = getDb();
  const rows = await db
    .select({
      id: buildingEquipmentRegistry.id,
      canonicalName: buildingEquipmentRegistry.canonicalName,
      category: buildingEquipmentRegistry.category,
      floor: buildingEquipmentRegistry.floor,
      location: buildingEquipmentRegistry.location,
      aliasesJson: buildingEquipmentRegistry.aliasesJson,
      componentKeywordsJson: buildingEquipmentRegistry.componentKeywordsJson,
      status: buildingEquipmentRegistry.status,
      parentEquipmentId: buildingEquipmentRegistry.parentEquipmentId,
    })
    .from(buildingEquipmentRegistry)
    .orderBy(asc(buildingEquipmentRegistry.canonicalName));

  return rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonicalName,
    category: row.category,
    floor: row.floor,
    location: row.location,
    aliases: parseJsonArray(row.aliasesJson),
    componentKeywords: parseJsonArray(row.componentKeywordsJson),
    status: (row.status as EquipmentRegistryDocument["status"]) || "active",
    parentEquipmentId: row.parentEquipmentId,
  }));
}

/**
 * Stage and resolve an equipment mention from an email source.
 * Does NOT mint durable canonical assets from raw mentions.
 */
export async function stageAndResolveEquipmentMention(input: {
  sourceEmailId?: string | null;
  modelId?: string | null;
  rawName: string;
  extractedRole?: "installed_system" | "bid_alternative" | "component" | null;
  parentSystemHint?: string | null;
  category?: string | null;
  confidence?: string | null;
  sourceQuote?: string | null;
  location?: string | null;
  floor?: number | null;
  contextSnippet?: string | null;
}): Promise<{
  id: string;
  decision: EquipmentResolveDecision;
}> {
  const db = getDb();
  const registry = await loadActiveEquipmentRegistryDocuments();

  const decision = decideEquipmentMentionResolution(
    {
      rawName: input.rawName,
      extractedRole: input.extractedRole,
      parentSystemHint: input.parentSystemHint,
      category: input.category,
      location: input.location,
      floor: input.floor,
      contextSnippet: input.contextSnippet,
    },
    registry,
  );

  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(equipmentMentions).values({
    id,
    sourceEmailId: input.sourceEmailId ?? null,
    modelId: input.modelId ?? null,
    rawName: input.rawName.trim(),
    extractedRole: input.extractedRole ?? null,
    parentSystemHint: input.parentSystemHint ?? null,
    category: input.category ?? null,
    resolvedEquipmentId: decision.resolvedEquipmentId ?? null,
    resolutionStatus: decision.status,
    resolutionReason: decision.reason,
    confidence: input.confidence ?? null,
    sourceQuote: input.sourceQuote ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, decision };
}

/**
 * Get aggregate statistics on equipment mentions.
 */
export async function getEquipmentMentionStats(): Promise<EquipmentMentionStats> {
  const db = getDb();
  const rows = await db
    .select({
      status: equipmentMentions.resolutionStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(equipmentMentions)
    .groupBy(equipmentMentions.resolutionStatus);

  let total = 0;
  let confirmed = 0;
  let provisional = 0;
  let unresolved = 0;

  for (const row of rows) {
    const c = Number(row.count) || 0;
    total += c;
    if (row.status === "confirmed") confirmed += c;
    else if (row.status === "provisional") provisional += c;
    else unresolved += c;
  }

  return { total, confirmed, provisional, unresolved };
}
