/**
 * Re-derive equipment anchor fields on existing project mentions from the
 * canonical building_equipment_registry, then optionally re-run resolution.
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectMentions } from "@/lib/db/schema";
import { loadActiveEquipmentRegistryDocuments } from "@/lib/equipment/mention-resolve";
import { resolveProjectAnchor } from "@/lib/projects/project-anchor-resolve";
import { resolveProjectMentions } from "@/lib/projects/mention-resolve";

export type RefreshProjectMentionAnchorsResult = {
  mentionCount: number;
  anchorsUpdated: number;
  anchorsFound: number;
  canonicalResolved: number;
};

export async function refreshProjectMentionAnchors(): Promise<RefreshProjectMentionAnchorsResult> {
  const db = getDb();
  const registry = await loadActiveEquipmentRegistryDocuments();

  const mentions = await db
    .select({
      id: projectMentions.id,
      rawName: projectMentions.rawName,
      location: projectMentions.location,
      extractedAnchorType: projectMentions.extractedAnchorType,
      extractedAnchorHint: projectMentions.extractedAnchorHint,
      resolvedAnchorId: projectMentions.resolvedAnchorId,
    })
    .from(projectMentions);

  let anchorsUpdated = 0;
  let anchorsFound = 0;
  let canonicalResolved = 0;
  const now = new Date().toISOString();

  for (const mention of mentions) {
    const anchor = resolveProjectAnchor(
      {
        rawName: mention.rawName,
        location: mention.location,
      },
      registry,
    );

    if (anchor.extractedAnchorType) {
      anchorsFound += 1;
      if (anchor.resolvedAnchorId) canonicalResolved += 1;
    }

    const changed =
      anchor.extractedAnchorType !== mention.extractedAnchorType ||
      anchor.extractedAnchorHint !== mention.extractedAnchorHint ||
      anchor.resolvedAnchorId !== mention.resolvedAnchorId;

    if (!changed) continue;

    await db
      .update(projectMentions)
      .set({
        extractedAnchorType: anchor.extractedAnchorType,
        extractedAnchorHint: anchor.extractedAnchorHint,
        resolvedAnchorId: anchor.resolvedAnchorId,
        updatedAt: now,
      })
      .where(eq(projectMentions.id, mention.id));
    anchorsUpdated += 1;
  }

  return {
    mentionCount: mentions.length,
    anchorsUpdated,
    anchorsFound,
    canonicalResolved,
  };
}

export async function refreshProjectMentionAnchorsAndResolve(params?: {
  limit?: number;
}): Promise<
  RefreshProjectMentionAnchorsResult & {
    resolution: Awaited<ReturnType<typeof resolveProjectMentions>>;
  }
> {
  const anchorRefresh = await refreshProjectMentionAnchors();
  const resolution = await resolveProjectMentions({ limit: params?.limit ?? 5000 });
  return { ...anchorRefresh, resolution };
}
