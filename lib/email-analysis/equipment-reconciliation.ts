import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

import {
  EQUIPMENT_RECONCILIATION_SYSTEM_PROMPT,
  buildEquipmentReconciliationUserPrompt,
} from "@/lib/email-analysis/prompts";
import {
  loadBuildingEquipmentRegistry,
  registryEntriesForReconciliation,
} from "@/lib/building/equipment-registry";
import { getDb } from "@/lib/db";
import {
  emails,
  equipmentAssets,
  extractionSources,
  maintenanceEvents,
} from "@/lib/db/schema";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

const MAX_THREAD_CHARS = 120_000;
const RECONCILIATION_MAX_OUTPUT_TOKENS = 8192;

export type ReconciledEquipment = {
  canonical_name: string;
  kind: "equipment" | "manufacturer" | "component";
  significance: "major" | "minor";
  equipment_role?: "installed_system" | "bid_alternative" | "component";
  parent_system?: string;
  manufacturer?: string;
  category?: string;
  aliases: string[];
  raw_names: string[];
  registry_id?: string;
  is_existing?: boolean;
  location?: string;
};

export type EquipmentReconciliationResult = {
  equipment: ReconciledEquipment[];
};

export type ReconcileThreadEquipmentResult = {
  beforeCount: number;
  afterCount: number;
  calls: GeminiUsageCall[];
  costUsd: number;
};

type ThreadEquipmentRow = {
  id: string;
  name: string;
  kind: string | null;
  significance: string | null;
  manufacturer: string | null;
  category: string | null;
  canonicalId: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function parseKind(value: unknown): ReconciledEquipment["kind"] {
  const kind = asString(value);
  if (kind === "manufacturer" || kind === "component") return kind;
  return "equipment";
}

function parseEquipmentRole(
  value: unknown,
): ReconciledEquipment["equipment_role"] | undefined {
  const role = asString(value);
  if (role === "installed_system" || role === "bid_alternative" || role === "component") {
    return role;
  }
  return undefined;
}

function parseSignificance(value: unknown): ReconciledEquipment["significance"] {
  return asString(value) === "minor" ? "minor" : "major";
}

export function parseEquipmentReconciliationResult(
  raw: unknown,
): EquipmentReconciliationResult {
  if (!isObject(raw)) return { equipment: [] };

  const equipmentRaw = raw.equipment;
  if (!Array.isArray(equipmentRaw)) return { equipment: [] };

  const equipment: ReconciledEquipment[] = [];
  for (const entry of equipmentRaw) {
    if (!isObject(entry)) continue;

    const canonicalName = asString(entry.canonical_name);
    if (!canonicalName) continue;

    equipment.push({
      canonical_name: canonicalName,
      kind: parseKind(entry.kind),
      significance: parseSignificance(entry.significance),
      equipment_role: parseEquipmentRole(entry.equipment_role),
      parent_system: asString(entry.parent_system),
      manufacturer: asString(entry.manufacturer),
      category: asString(entry.category),
      aliases: asStringArray(entry.aliases),
      raw_names: asStringArray(entry.raw_names),
      registry_id: asString(entry.registry_id),
      is_existing: typeof entry.is_existing === "boolean" ? entry.is_existing : undefined,
      location: asString(entry.location),
    });
  }

  return { equipment };
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

async function loadThreadEquipmentRows(threadId: string): Promise<ThreadEquipmentRow[]> {
  const db = getDb();

  const sourceRows = await db
    .select({ id: extractionSources.id })
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, threadId));

  const sourceIds = sourceRows.map((row) => row.id);
  if (!sourceIds.length) return [];

  const eventEquipmentIds = await db
    .select({ equipmentId: maintenanceEvents.equipmentId })
    .from(maintenanceEvents)
    .where(inArray(maintenanceEvents.sourceId, sourceIds));

  const equipmentIds = [
    ...new Set(
      eventEquipmentIds
        .map((row) => row.equipmentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!equipmentIds.length) return [];

  return db
    .select({
      id: equipmentAssets.id,
      name: equipmentAssets.name,
      kind: equipmentAssets.kind,
      significance: equipmentAssets.significance,
      manufacturer: equipmentAssets.manufacturer,
      category: equipmentAssets.category,
      canonicalId: equipmentAssets.canonicalId,
    })
    .from(equipmentAssets)
    .where(
      and(
        inArray(equipmentAssets.id, equipmentIds),
        isNull(equipmentAssets.canonicalId),
      ),
    )
    .orderBy(asc(equipmentAssets.name));
}

async function findEquipmentByName(name: string): Promise<ThreadEquipmentRow | null> {
  const db = getDb();
  const normalized = name.trim();
  const [exact] = await db
    .select({
      id: equipmentAssets.id,
      name: equipmentAssets.name,
      kind: equipmentAssets.kind,
      significance: equipmentAssets.significance,
      manufacturer: equipmentAssets.manufacturer,
      category: equipmentAssets.category,
      canonicalId: equipmentAssets.canonicalId,
    })
    .from(equipmentAssets)
    .where(eq(equipmentAssets.name, normalized))
    .limit(1);

  if (exact) return exact;

  const allAssets = await db
    .select({
      id: equipmentAssets.id,
      name: equipmentAssets.name,
      kind: equipmentAssets.kind,
      significance: equipmentAssets.significance,
      manufacturer: equipmentAssets.manufacturer,
      category: equipmentAssets.category,
      canonicalId: equipmentAssets.canonicalId,
      aliasesJson: equipmentAssets.aliasesJson,
    })
    .from(equipmentAssets);

  const normalizedLower = normalized.toLowerCase();
  for (const asset of allAssets) {
    if (asset.name.trim().toLowerCase() === normalizedLower) {
      return asset;
    }
    if (asset.aliasesJson) {
      try {
        const aliases = JSON.parse(asset.aliasesJson) as unknown;
        if (
          Array.isArray(aliases) &&
          aliases.some(
            (alias) =>
              typeof alias === "string" &&
              alias.trim().toLowerCase() === normalizedLower,
          )
        ) {
          return asset;
        }
      } catch {
        // ignore malformed aliases
      }
    }
  }

  return null;
}

function resolvePersistedCategory(item: ReconciledEquipment): string | null {
  if (item.equipment_role === "bid_alternative") return "bid alternative";
  return item.category ?? null;
}

function resolvePersistedNotes(item: ReconciledEquipment): string | null {
  if (item.parent_system?.trim()) {
    return `Related system: ${item.parent_system.trim()}`;
  }
  return null;
}

async function applyEquipmentReconciliation(input: {
  threadId: string;
  reconciled: ReconciledEquipment[];
}): Promise<number> {
  const db = getDb();
  let canonicalCount = 0;

  for (const item of input.reconciled) {
    const namesToResolve = [
      item.canonical_name,
      ...item.raw_names,
      ...item.aliases,
    ].filter((name, index, array) => array.indexOf(name) === index);

    const matchedAssets: ThreadEquipmentRow[] = [];
    for (const name of namesToResolve) {
      const asset = await findEquipmentByName(name);
      if (asset && !matchedAssets.some((row) => row.id === asset.id)) {
        matchedAssets.push(asset);
      }
    }

    let canonicalAsset =
      matchedAssets.find(
        (asset) =>
          asset.name.trim().toLowerCase() ===
          item.canonical_name.trim().toLowerCase(),
      ) ?? matchedAssets[0];

    if (!canonicalAsset) {
      const id = randomUUID();
      await db.insert(equipmentAssets).values({
        id,
        name: item.canonical_name.trim(),
        kind: item.kind,
        significance: item.significance,
        manufacturer: item.manufacturer ?? null,
        category: resolvePersistedCategory(item),
        notes: resolvePersistedNotes(item),
        location: item.location ?? null,
        registryId: item.registry_id ?? null,
        source: item.is_existing ? "registry_match" : "extracted",
        aliasesJson:
          item.aliases.length > 0 ? JSON.stringify(item.aliases) : null,
        createdAt: new Date().toISOString(),
      });
      canonicalAsset = {
        id,
        name: item.canonical_name.trim(),
        kind: item.kind,
        significance: item.significance,
        manufacturer: item.manufacturer ?? null,
        category: item.category ?? null,
        canonicalId: null,
      };
    } else {
      await db
        .update(equipmentAssets)
        .set({
          name: item.canonical_name.trim(),
          kind: item.kind,
          significance: item.significance,
          manufacturer: item.manufacturer ?? canonicalAsset.manufacturer,
          category: resolvePersistedCategory(item) ?? canonicalAsset.category,
          notes: resolvePersistedNotes(item),
          location: item.location ?? null,
          registryId: item.registry_id ?? null,
          aliasesJson:
            item.aliases.length > 0 ? JSON.stringify(item.aliases) : null,
          canonicalId: null,
        })
        .where(eq(equipmentAssets.id, canonicalAsset.id));
      canonicalAsset = {
        ...canonicalAsset,
        name: item.canonical_name.trim(),
        kind: item.kind,
        significance: item.significance,
      };
    }

    const duplicateIds = matchedAssets
      .filter((asset) => asset.id !== canonicalAsset!.id)
      .map((asset) => asset.id);

    if (duplicateIds.length) {
      await db
        .update(equipmentAssets)
        .set({ canonicalId: canonicalAsset.id })
        .where(inArray(equipmentAssets.id, duplicateIds));

      await db
        .update(maintenanceEvents)
        .set({
          equipmentId: canonicalAsset.id,
          equipmentName: canonicalAsset.name,
        })
        .where(inArray(maintenanceEvents.equipmentId, duplicateIds));
    }

    const sourceRows = await db
      .select({ id: extractionSources.id })
      .from(extractionSources)
      .where(eq(extractionSources.emailThreadId, input.threadId));
    const sourceIds = sourceRows.map((row) => row.id);

    if (sourceIds.length) {
      for (const rawName of namesToResolve) {
        await db
          .update(maintenanceEvents)
          .set({
            equipmentId: canonicalAsset.id,
            equipmentName: canonicalAsset.name,
          })
          .where(
            and(
              inArray(maintenanceEvents.sourceId, sourceIds),
              eq(maintenanceEvents.equipmentName, rawName.trim()),
            ),
          );
      }
    }

    canonicalCount += 1;
  }

  return canonicalCount;
}

export async function reconcileThreadEquipment(input: {
  threadId: string;
  sourceId: string;
  modelName: string;
}): Promise<ReconcileThreadEquipmentResult> {
  const threadEquipment = await loadThreadEquipmentRows(input.threadId);
  if (threadEquipment.length < 2) {
    return {
      beforeCount: threadEquipment.length,
      afterCount: threadEquipment.length,
      calls: [],
      costUsd: 0,
    };
  }

  const threadMessages = await loadThreadMessages(input.threadId);
  if (!threadMessages.length) {
    return {
      beforeCount: threadEquipment.length,
      afterCount: threadEquipment.length,
      calls: [],
      costUsd: 0,
    };
  }

  const registryEntries = registryEntriesForReconciliation(
    await loadBuildingEquipmentRegistry(),
  );

  const userPrompt = buildEquipmentReconciliationUserPrompt({
    threadTranscript: buildThreadTranscript(threadMessages),
    extractedEquipment: threadEquipment.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      significance: row.significance,
      manufacturer: row.manufacturer,
      category: row.category,
    })),
    registryEntries,
  });

  const generation = await generateEmailExtraction({
    systemInstruction: EQUIPMENT_RECONCILIATION_SYSTEM_PROMPT,
    userText: userPrompt,
    modelName: input.modelName,
    maxOutputTokens: RECONCILIATION_MAX_OUTPUT_TOKENS,
    step: "equipment_reconciliation",
  });

  const { jsonText } = unwrapJsonCodeBlock(generation.text);
  const parsed = parseEquipmentReconciliationResult(
    JSON.parse(jsonText) as unknown,
  );

  if (!parsed.equipment.length) {
    console.warn("[email-analysis:equipment-reconcile]", {
      threadId: input.threadId,
      message: "AI returned no equipment; keeping original rows",
    });
    return {
      beforeCount: threadEquipment.length,
      afterCount: threadEquipment.length,
      calls: generation.usageCalls,
      costUsd: estimateCostUsdForCalls(generation.usageCalls),
    };
  }

  const afterCount = await applyEquipmentReconciliation({
    threadId: input.threadId,
    reconciled: parsed.equipment,
  });

  const calls = generation.usageCalls;
  const costUsd = estimateCostUsdForCalls(calls);

  console.info("[email-analysis:equipment-reconcile]", {
    threadId: input.threadId,
    beforeCount: threadEquipment.length,
    afterCount,
    canonicalGroups: parsed.equipment.length,
    costUsd,
  });

  return {
    beforeCount: threadEquipment.length,
    afterCount,
    calls,
    costUsd,
  };
}

/** Re-run reconciliation for an existing thread without re-analyzing emails. */
export async function reconcileExistingThreadEquipment(input: {
  threadId: string;
  modelName: string;
}): Promise<ReconcileThreadEquipmentResult> {
  const db = getDb();
  const [latestSource] = await db
    .select({ id: extractionSources.id })
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, input.threadId))
    .orderBy(desc(extractionSources.processedAt))
    .limit(1);

  return reconcileThreadEquipment({
    threadId: input.threadId,
    sourceId: latestSource?.id ?? input.threadId,
    modelName: input.modelName,
  });
}
