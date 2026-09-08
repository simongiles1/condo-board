/**
 * Dedicated equipment harvest worker.
 *
 * Scans email analysis documents and project mentions for equipment mentions,
 * resolves them against the canonical building_equipment_registry, routes
 * components to parent systems, and stages them into equipment_mentions.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emails,
  equipmentMentions,
  extractionSources,
  projectMentions,
} from "@/lib/db/schema";
import {
  stageAndResolveEquipmentMention,
  type EquipmentMentionStats,
} from "@/lib/equipment/mention-resolve";

export type EquipmentHarvestOptions = {
  emailIds?: string[];
  limit?: number;
};

export type EquipmentHarvestResult = {
  scanned: number;
  staged: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
};

type RawExtractedMention = {
  name: string;
  kind?: string;
  significance?: string;
  equipment_role?: "installed_system" | "bid_alternative" | "component";
  parent_system?: string;
  manufacturer?: string;
  category?: string;
  source_quote?: string;
  confidence?: string;
};

function parseExtractedMentions(rawJson: unknown): RawExtractedMention[] {
  if (!rawJson) return [];
  try {
    const doc =
      typeof rawJson === "string" ? JSON.parse(rawJson) : (rawJson as Record<string, unknown>);
    if (Array.isArray(doc.equipment_mentions)) {
      return doc.equipment_mentions.filter(
        (m: unknown): m is RawExtractedMention =>
          Boolean(m && typeof m === "object" && "name" in m && typeof (m as RawExtractedMention).name === "string"),
      );
    }
  } catch {
    // fallback
  }
  return [];
}

/**
 * Harvest equipment mentions from extraction sources and project mentions.
 */
export async function harvestEquipmentMentions(
  options?: EquipmentHarvestOptions,
): Promise<EquipmentHarvestResult> {
  const db = getDb();
  const limit = options?.limit ?? 500;
  const emailIds = options?.emailIds?.map((id) => id.trim()).filter(Boolean);

  const result: EquipmentHarvestResult = {
    scanned: 0,
    staged: 0,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
  };

  // 1. Process email extractionSources
  const sourceQuery = db
    .select({
      id: extractionSources.id,
      sourceId: extractionSources.sourceId,
      sourceType: extractionSources.sourceType,
      rawExtractionJson: extractionSources.rawExtractionJson,
    })
    .from(extractionSources)
    .where(
      and(
        eq(extractionSources.sourceType, "email_message"),
        isNotNull(extractionSources.rawExtractionJson),
        emailIds && emailIds.length > 0
          ? inArray(extractionSources.sourceId, emailIds)
          : undefined,
      ),
    )
    .limit(limit);

  const sources = await sourceQuery;

  // Track already-staged mentions to avoid re-inserting identical per-email items
  const existingMentions = await db
    .select({
      sourceEmailId: equipmentMentions.sourceEmailId,
      rawName: equipmentMentions.rawName,
    })
    .from(equipmentMentions);

  const seenPerEmail = new Set(
    existingMentions.map(
      (m) => `${m.sourceEmailId ?? ""}|${m.rawName.toLowerCase().trim()}`,
    ),
  );

  for (const source of sources) {
    if (!source.sourceId) continue;
    const mentions = parseExtractedMentions(source.rawExtractionJson);

    for (const mention of mentions) {
      result.scanned += 1;
      const rawName = mention.name.trim();
      if (!rawName) continue;

      const key = `${source.sourceId}|${rawName.toLowerCase()}`;
      if (seenPerEmail.has(key)) continue;
      seenPerEmail.add(key);

      const staged = await stageAndResolveEquipmentMention({
        sourceEmailId: source.sourceId,
        rawName,
        extractedRole: mention.equipment_role,
        parentSystemHint: mention.parent_system,
        category: mention.category,
        confidence: mention.confidence,
        sourceQuote: mention.source_quote,
      });

      result.staged += 1;
      if (staged.decision.status === "confirmed") result.confirmed += 1;
      else if (staged.decision.status === "provisional") result.provisional += 1;
      else result.unresolved += 1;
    }
  }

  // 2. Also harvest equipment mentions from project_mentions with equipment anchor hint
  const projectMentionsWithEquipment = await db
    .select({
      sourceEmailId: projectMentions.sourceEmailId,
      extractedAnchorHint: projectMentions.extractedAnchorHint,
      rawName: projectMentions.rawName,
      location: projectMentions.location,
    })
    .from(projectMentions)
    .where(
      and(
        eq(projectMentions.extractedAnchorType, "equipment"),
        isNotNull(projectMentions.extractedAnchorHint),
      ),
    )
    .limit(limit);

  for (const pm of projectMentionsWithEquipment) {
    if (!pm.sourceEmailId || !pm.extractedAnchorHint?.trim()) continue;
    const hint = pm.extractedAnchorHint.trim();
    const key = `${pm.sourceEmailId}|${hint.toLowerCase()}`;
    if (seenPerEmail.has(key)) continue;
    seenPerEmail.add(key);

    result.scanned += 1;
    const staged = await stageAndResolveEquipmentMention({
      sourceEmailId: pm.sourceEmailId,
      rawName: hint,
      location: pm.location,
      contextSnippet: pm.rawName,
    });

    result.staged += 1;
    if (staged.decision.status === "confirmed") result.confirmed += 1;
    else if (staged.decision.status === "provisional") result.provisional += 1;
    else result.unresolved += 1;
  }

  return result;
}
