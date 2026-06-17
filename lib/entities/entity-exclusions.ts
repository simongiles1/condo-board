/** Persistent registry of entities the board has flagged to ignore during extraction. */

import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { entityExclusions } from "@/lib/db/schema";
import { entitiesMatch } from "@/lib/email/entity-dedup";
import { buildEntityDedupKey } from "@/lib/entities/entity-review";

export type EntityExclusionRow = {
  id: string;
  entityType: string;
  entityValue: string;
  dedupKey: string;
  note: string | null;
  createdAt: string;
};

export type EntityExclusionInput = {
  entityType: string;
  entityValue: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function buildExclusionDedupKey(input: EntityExclusionInput): string {
  if (input.entityType === "email") {
    return `email:${normalizeEmail(input.entityValue)}`;
  }
  return buildEntityDedupKey({
    type: input.entityType,
    value: input.entityValue.trim(),
  });
}

export function dedupeExclusionInputs(
  entries: EntityExclusionInput[],
): EntityExclusionInput[] {
  const seen = new Set<string>();
  const deduped: EntityExclusionInput[] = [];

  for (const entry of entries) {
    const value = entry.entityValue.trim();
    if (!value) continue;

    const key = buildExclusionDedupKey({ entityType: entry.entityType, entityValue: value });
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ entityType: entry.entityType, entityValue: value });
  }

  return deduped;
}

export async function loadEntityExclusions(): Promise<EntityExclusionRow[]> {
  const db = getDb();
  return db.select().from(entityExclusions);
}

export function formatEntityExclusionsForPrompt(
  exclusions: EntityExclusionRow[],
): string {
  if (!exclusions.length) return "";

  const lines = exclusions.map((entry) => {
    const label =
      entry.entityType === "email" ? "email address" : entry.entityType;
    return `- ${label}: ${entry.entityValue}`;
  });

  return `

EXCLUDED ENTITIES — DO NOT EXTRACT (flagged by the board as irrelevant, e.g. old employer signatures):
${lines.join("\n")}
Do not include these in entities[], vendors[], or contracts[]. Omit related contact details when they belong solely to an excluded signature block.`;
}

export function isEntityExcluded(
  entity: { type: string; value: string },
  exclusions: EntityExclusionRow[],
): boolean {
  const value = entity.value.trim();
  if (!value) return false;

  for (const exclusion of exclusions) {
    if (exclusion.entityType === "email") {
      if (entity.type === "email" && normalizeEmail(value) === normalizeEmail(exclusion.entityValue)) {
        return true;
      }
      if (value.includes("@") && normalizeEmail(value) === normalizeEmail(exclusion.entityValue)) {
        return true;
      }
      continue;
    }

    if (
      entitiesMatch(
        { type: exclusion.entityType, value: exclusion.entityValue },
        entity,
      )
    ) {
      return true;
    }
  }

  return false;
}

export function isExcludedContact(input: {
  person?: string | null;
  org?: string | null;
  phone?: string | null;
  email?: string | null;
  exclusions: EntityExclusionRow[];
}): boolean {
  const checks: Array<{ type: string; value: string | null | undefined }> = [
    { type: "person", value: input.person },
    { type: "org", value: input.org },
    { type: "phone", value: input.phone },
    { type: "email", value: input.email },
  ];

  return checks.some(
    (entry) => entry.value && isEntityExcluded({ type: entry.type, value: entry.value }, input.exclusions),
  );
}

export async function registerEntityExclusions(
  entries: EntityExclusionInput[],
  note?: string,
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  let inserted = 0;

  for (const entry of dedupeExclusionInputs(entries)) {
    const dedupKey = buildExclusionDedupKey(entry);
    const [existing] = await db
      .select({ id: entityExclusions.id })
      .from(entityExclusions)
      .where(eq(entityExclusions.dedupKey, dedupKey))
      .limit(1);
    if (existing) continue;

    await db.insert(entityExclusions).values({
      id: randomUUID(),
      entityType: entry.entityType,
      entityValue: entry.entityValue,
      dedupKey,
      note: note ?? null,
      createdAt: now,
    });
    inserted += 1;
  }

  return inserted;
}

export async function loadEntityExclusionsPromptSection(): Promise<string> {
  const exclusions = await loadEntityExclusions();
  return formatEntityExclusionsForPrompt(exclusions);
}
