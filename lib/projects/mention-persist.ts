/**
 * Upsert per-email project mentions from pass-3 fingerprint cards.
 * Does not mint project_entities. Resolution is a separate pass.
 */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectMentions } from "@/lib/db/schema";
import type { ProjectEntityCard } from "@/lib/email-analysis/project-highlight-shared";
import { loadOrganizationIdentityNameKeys } from "@/lib/projects/org-identity-keys";
import {
  cardToProjectMentionCard,
  projectMentionFingerprint,
  projectMentionIdentityKey,
  projectMentionIsMinted,
} from "@/lib/projects/mention-shared";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";

export type UpsertProjectMentionsResult = {
  written: number;
  skipped: number;
};

export async function upsertProjectMentionsForEmail(params: {
  sourceEmailId: string;
  entityCards: ProjectEntityCard[];
  modelId?: string | null;
  fingerprintMergeId?: string | null;
}): Promise<UpsertProjectMentionsResult> {
  const sourceEmailId = params.sourceEmailId.trim();
  if (!sourceEmailId) return { written: 0, skipped: 0 };

  const orgNameKeys = await loadOrganizationIdentityNameKeys().catch(
    () => new Set<string>(),
  );
  const db = getDb();
  const now = new Date().toISOString();
  let written = 0;
  let skipped = 0;

  for (const raw of params.entityCards) {
    const card = cardToProjectMentionCard(raw);
    if (!card) {
      skipped += 1;
      continue;
    }
    const fingerprint = projectMentionFingerprint(card);
    if (!fingerprint.replace(/\|/g, "")) {
      skipped += 1;
      continue;
    }

    const nameKey = normalizeProjectNameKey(card.raw_name) || null;
    const identityKey = projectMentionIdentityKey(card);
    const minted = projectMentionIsMinted(card, orgNameKeys);

    const [existing] = await db
      .select({ id: projectMentions.id })
      .from(projectMentions)
      .where(
        and(
          eq(projectMentions.sourceEmailId, sourceEmailId),
          eq(projectMentions.fingerprint, fingerprint),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(projectMentions)
        .set({
          rawName: card.raw_name,
          contractor: card.contractor,
          yearHint: card.year_hint,
          phase: card.phase,
          location: card.location,
          nameKey,
          identityKey,
          minted,
          modelId: params.modelId ?? null,
          fingerprintMergeId: params.fingerprintMergeId ?? null,
          updatedAt: now,
        })
        .where(eq(projectMentions.id, existing.id));
      written += 1;
      continue;
    }

    await db.insert(projectMentions).values({
      id: randomUUID(),
      sourceEmailId,
      fingerprintMergeId: params.fingerprintMergeId ?? null,
      modelId: params.modelId ?? null,
      rawName: card.raw_name,
      contractor: card.contractor,
      yearHint: card.year_hint,
      phase: card.phase,
      location: card.location,
      nameKey,
      identityKey,
      fingerprint,
      minted,
      resolutionStatus: "unresolved",
      resolvedProjectId: null,
      resolutionReason: null,
      createdAt: now,
      updatedAt: now,
    });
    written += 1;
  }

  return { written, skipped };
}
