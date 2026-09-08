/**
 * In-place incident → capital_project promotion.
 * Mention rows keep the same resolved_project_id; only tier + reasons change.
 */

import { eq, inArray, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  projectBoardMentions,
  projectEntities,
  projectMentions,
} from "@/lib/db/schema";
import { invalidateProjectFingerprintSummariesCache } from "@/lib/projects/fingerprint-list";
import { parseProjectAliasesJson } from "@/lib/projects/project-multi-values";
import {
  attachmentFilenameLooksLikeQuote,
  capitalProjectPromotionPatch,
  collectIncidentPromotionReasons,
  countFormalQuoteIdentifiers,
  mergePromotionReasons,
  type IncidentPromotionFacts,
  type ProjectPromotionReason,
} from "@/lib/projects/project-promotion-shared";
import type { ProjectTier } from "@/lib/projects/mention-resolve-shared";

export type PromoteIncidentResult = {
  promoted: boolean;
  projectId: string;
  tier: ProjectTier;
  reasons: string[];
};

function parseReasonsJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function loadIncidentPromotionFacts(
  projectId: string,
): Promise<IncidentPromotionFacts | null> {
  const db = getDb();
  const [entity] = await db
    .select({
      id: projectEntities.id,
      identityKey: projectEntities.identityKey,
      aliasesJson: projectEntities.aliasesJson,
      name: projectEntities.name,
    })
    .from(projectEntities)
    .where(eq(projectEntities.id, projectId))
    .limit(1);
  if (!entity) return null;

  const boardRows = await db
    .select({ id: projectBoardMentions.id })
    .from(projectBoardMentions)
    .where(
      or(
        eq(projectBoardMentions.projectKey, entity.id),
        eq(projectBoardMentions.projectKey, entity.identityKey),
      ),
    );

  const mentionRows = await db
    .select({
      sourceEmailId: projectMentions.sourceEmailId,
      rawName: projectMentions.rawName,
      receivedAt: emails.receivedAt,
    })
    .from(projectMentions)
    .leftJoin(emails, eq(projectMentions.sourceEmailId, emails.id))
    .where(eq(projectMentions.resolvedProjectId, projectId));

  const emailIds = [
    ...new Set(
      mentionRows
        .map((row) => row.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const receivedAts = mentionRows
    .map((row) => row.receivedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  const aliases = parseProjectAliasesJson(entity.aliasesJson);
  let quoteOrRfpCount = countFormalQuoteIdentifiers([
    entity.name,
    ...aliases,
    ...mentionRows.map((row) => row.rawName),
  ]);

  if (emailIds.length > 0) {
    const attachments = await db
      .select({ filename: emailAttachments.filename })
      .from(emailAttachments)
      .where(inArray(emailAttachments.emailId, emailIds));
    const quoteFiles = attachments.filter((row) =>
      attachmentFilenameLooksLikeQuote(row.filename),
    );
    quoteOrRfpCount += quoteFiles.length;
  }

  return {
    quoteOrRfpCount,
    boardReportCount: boardRows.length,
    mentionEmailCount: emailIds.length,
    firstMentionAt: receivedAts[0] ?? null,
    lastMentionAt: receivedAts[receivedAts.length - 1] ?? null,
  };
}

export async function evaluateIncidentPromotionCriteria(
  projectId: string,
): Promise<ProjectPromotionReason[]> {
  const facts = await loadIncidentPromotionFacts(projectId);
  if (!facts) return [];
  return collectIncidentPromotionReasons(facts);
}

/**
 * Promote a service_call / incident to capital_project in place.
 * Does not rewrite project_mentions.resolved_project_id.
 */
export async function promoteIncidentToProject(
  projectId: string,
  manualReason?: string,
): Promise<PromoteIncidentResult | null> {
  const trimmedId = projectId.trim();
  if (!trimmedId) return null;

  const db = getDb();
  const [entity] = await db
    .select({
      id: projectEntities.id,
      tier: projectEntities.tier,
      promotionReasonsJson: projectEntities.promotionReasonsJson,
    })
    .from(projectEntities)
    .where(eq(projectEntities.id, trimmedId))
    .limit(1);
  if (!entity) return null;

  const existingReasons = parseReasonsJson(entity.promotionReasonsJson);
  const currentTier = (entity.tier as ProjectTier) ?? "service_call";
  if (currentTier === "capital_project") {
    return {
      promoted: false,
      projectId: entity.id,
      tier: "capital_project",
      reasons: existingReasons,
    };
  }

  const autoReasons = await evaluateIncidentPromotionCriteria(
    entity.id,
  );
  const nextReasons = mergePromotionReasons(existingReasons, [
    ...autoReasons,
    ...(manualReason?.trim() ? [manualReason.trim()] : []),
  ]);

  if (autoReasons.length === 0 && !manualReason?.trim()) {
    return {
      promoted: false,
      projectId: entity.id,
      tier: currentTier,
      reasons: existingReasons,
    };
  }

  const nowIso = new Date().toISOString();
  const patch = capitalProjectPromotionPatch(nextReasons, nowIso);
  await db
    .update(projectEntities)
    .set(patch)
    .where(eq(projectEntities.id, entity.id));
  invalidateProjectFingerprintSummariesCache();

  return {
    promoted: true,
    projectId: entity.id,
    tier: "capital_project",
    reasons: nextReasons,
  };
}
