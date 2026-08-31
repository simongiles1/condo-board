/**
 * Resolve project mentions onto project_entities.
 * Identity-key unique match confirms. Otherwise an in-memory lexical
 * shortlist (name + aliases + contractor + year + location) feeds
 * decideProjectMentionResolution — no bulk UPDATE by name.
 */

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectMentions } from "@/lib/db/schema";
import { invalidateProjectFingerprintSummariesCache } from "@/lib/projects/fingerprint-list";
import {
  decideProjectMentionResolution,
  shortlistProjectMentionCandidates,
  type ProjectMentionSearchDocument,
} from "@/lib/projects/mention-resolve-shared";
import {
  loadActiveProjectEntities,
  syncProjectEntitiesFromFingerprints,
} from "@/lib/projects/registry-sync";

export type ResolveProjectMentionsResult = {
  scanned: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
  retracted: number;
};

function toSearchDocument(entity: {
  id: string;
  identityKey: string;
  name: string | null;
  aliases: string[];
  contractor: string | null;
  yearHint: string | null;
  location: string | null;
}): ProjectMentionSearchDocument {
  return {
    id: entity.id,
    identityKey: entity.identityKey,
    name: entity.name,
    aliases: entity.aliases,
    contractor: entity.contractor,
    yearHint: entity.yearHint,
    location: entity.location,
  };
}

/**
 * Sync fingerprint summaries into project_entities (including aliases),
 * then re-run the decision function on unresolved and provisional mentions.
 */
export async function refreshProjectEntitiesAndResolveMentions(params?: {
  emailIds?: string[];
  limit?: number;
}): Promise<ResolveProjectMentionsResult> {
  try {
    invalidateProjectFingerprintSummariesCache();
    await syncProjectEntitiesFromFingerprints();
  } catch (error) {
    console.error("[project-mentions] entity sync failed", {
      error:
        error instanceof Error ? error.message : "Project entity sync failed",
    });
  }
  return resolveProjectMentions(params);
}

/**
 * Attach unresolved/provisional mentions via unique identity key or
 * lexical uniqueness + year compatibility. Confirmed rows are left alone.
 */
export async function resolveProjectMentions(params?: {
  emailIds?: string[];
  limit?: number;
}): Promise<ResolveProjectMentionsResult> {
  const db = getDb();
  const limit = params?.limit ?? 2000;
  const emailIds = params?.emailIds
    ?.map((id) => id.trim())
    .filter(Boolean);

  const statusFilter = inArray(projectMentions.resolutionStatus, [
    "unresolved",
    "provisional",
  ]);
  const mentionRows =
    emailIds && emailIds.length > 0
      ? await db
          .select()
          .from(projectMentions)
          .where(and(statusFilter, inArray(projectMentions.sourceEmailId, emailIds)))
          .limit(limit)
      : await db
          .select()
          .from(projectMentions)
          .where(statusFilter)
          .limit(limit);

  const result: ResolveProjectMentionsResult = {
    scanned: mentionRows.length,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
    retracted: 0,
  };
  if (mentionRows.length === 0) return result;

  const entities = await loadActiveProjectEntities();
  const documents = entities.map(toSearchDocument);
  const idsByIdentityKey = new Map<string, string[]>();
  for (const entity of entities) {
    const list = idsByIdentityKey.get(entity.identityKey) ?? [];
    list.push(entity.id);
    idsByIdentityKey.set(entity.identityKey, list);
  }

  const now = new Date().toISOString();
  for (const mention of mentionRows) {
    const identityKey = mention.identityKey?.trim() || "";
    const uniqueIdentityMatches =
      mention.minted && identityKey
        ? (idsByIdentityKey.get(identityKey) ?? [])
        : [];
    const lexicalCandidates =
      uniqueIdentityMatches.length > 0
        ? []
        : shortlistProjectMentionCandidates(
            {
              rawName: mention.rawName,
              contractor: mention.contractor,
              yearHint: mention.yearHint,
              location: mention.location,
            },
            documents,
          );

    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches,
      lexicalCandidates,
    });

    const wasProvisional = mention.resolutionStatus === "provisional";
    const unchanged =
      mention.resolutionStatus === decision.status &&
      (mention.resolvedProjectId ?? null) === decision.projectId &&
      (mention.resolutionReason ?? null) === decision.reason;
    if (unchanged) {
      if (decision.status === "confirmed") result.confirmed += 1;
      else if (decision.status === "provisional") result.provisional += 1;
      else result.unresolved += 1;
      continue;
    }

    await db
      .update(projectMentions)
      .set({
        resolutionStatus: decision.status,
        resolvedProjectId: decision.projectId,
        resolutionReason: decision.reason,
        updatedAt: now,
      })
      .where(eq(projectMentions.id, mention.id));

    if (wasProvisional && decision.status === "unresolved") {
      result.retracted += 1;
    }
    if (decision.status === "confirmed") result.confirmed += 1;
    else if (decision.status === "provisional") result.provisional += 1;
    else result.unresolved += 1;
  }

  return result;
}
