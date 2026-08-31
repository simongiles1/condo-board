/**
 * Load grouped project mentions for the Projects Mentions tab.
 */

import { desc, eq, sql } from "drizzle-orm";

import {
  extractMentionContextSnippet,
} from "@/lib/contacts/mention-queue-shared";
import { getDb } from "@/lib/db";
import { emails, projectEntities, projectMentions } from "@/lib/db/schema";
import {
  buildProjectMentionQueueGroups,
  parseProjectMentionQueueView,
  type ProjectMentionQueueGroup,
  type ProjectMentionQueueRow,
  type ProjectMentionQueueView,
  type ProjectMentionStats,
} from "@/lib/projects/mention-queue-shared";
import type { ProjectMentionResolutionStatus } from "@/lib/projects/mention-shared";

const LOAD_LIMIT = 8000;
/** Snippet search only needs a window around the name, not full MIME bodies. */
const SEARCH_BODY_CHARS = 4000;

export async function getProjectMentionStats(): Promise<ProjectMentionStats> {
  const db = getDb();
  const rows = await db
    .select({
      status: projectMentions.resolutionStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(projectMentions)
    .groupBy(projectMentions.resolutionStatus);

  const stats: ProjectMentionStats = {
    total: 0,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
  };
  for (const row of rows) {
    const count = Number(row.count) || 0;
    stats.total += count;
    if (row.status === "confirmed") stats.confirmed = count;
    else if (row.status === "provisional") stats.provisional = count;
    else if (row.status === "unresolved") stats.unresolved = count;
  }
  return stats;
}

function statusFromDb(value: string): ProjectMentionResolutionStatus {
  if (value === "confirmed" || value === "provisional") return value;
  return "unresolved";
}

export async function loadProjectMentionQueueGroups(params?: {
  view?: ProjectMentionQueueView | string | null;
}): Promise<{
  view: ProjectMentionQueueView;
  groups: ProjectMentionQueueGroup[];
  stats: ProjectMentionStats;
}> {
  const view = parseProjectMentionQueueView(params?.view);
  const db = getDb();
  const started = Date.now();
  const stats = await getProjectMentionStats();
  const viewCount =
    view === "confirmed"
      ? stats.confirmed
      : view === "provisional"
        ? stats.provisional
        : stats.unresolved;
  if (viewCount === 0) {
    console.info("[project-mentions:queue]", {
      view,
      rows: 0,
      groups: 0,
      stats,
      ms: Date.now() - started,
    });
    return { view, groups: [], stats };
  }

  const rows = await db
    .select({
      id: projectMentions.id,
      rawName: projectMentions.rawName,
      contractor: projectMentions.contractor,
      yearHint: projectMentions.yearHint,
      phase: projectMentions.phase,
      location: projectMentions.location,
      nameKey: projectMentions.nameKey,
      identityKey: projectMentions.identityKey,
      fingerprint: projectMentions.fingerprint,
      minted: projectMentions.minted,
      resolutionStatus: projectMentions.resolutionStatus,
      resolutionReason: projectMentions.resolutionReason,
      resolvedProjectId: projectMentions.resolvedProjectId,
      resolvedProjectName: projectEntities.name,
      resolvedProjectIdentityKey: projectEntities.identityKey,
      sourceEmailId: projectMentions.sourceEmailId,
      threadId: emails.threadId,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      searchBody: sql<string | null>`left(coalesce(${emails.bodyTextStrictUnique}, ${emails.bodyTextUnique}, ${emails.bodyText}), ${SEARCH_BODY_CHARS})`,
    })
    .from(projectMentions)
    .leftJoin(emails, eq(projectMentions.sourceEmailId, emails.id))
    .leftJoin(
      projectEntities,
      eq(projectMentions.resolvedProjectId, projectEntities.id),
    )
    .where(eq(projectMentions.resolutionStatus, view))
    .orderBy(desc(emails.receivedAt))
    .limit(LOAD_LIMIT);

  const queueRows: ProjectMentionQueueRow[] = rows.map((row) => {
    const terms = [row.rawName, row.contractor];
    const contextSnippet =
      extractMentionContextSnippet(row.searchBody ?? "", terms) ??
      extractMentionContextSnippet(row.subject ?? "", terms);
    return {
      id: row.id,
      rawName: row.rawName,
      contractor: row.contractor,
      yearHint: row.yearHint,
      phase: row.phase,
      location: row.location,
      nameKey: row.nameKey,
      identityKey: row.identityKey,
      fingerprint: row.fingerprint,
      minted: Boolean(row.minted),
      resolutionStatus: statusFromDb(row.resolutionStatus),
      resolutionReason: row.resolutionReason,
      resolvedProjectId: row.resolvedProjectId,
      resolvedProjectName: row.resolvedProjectName,
      resolvedProjectIdentityKey: row.resolvedProjectIdentityKey,
      sourceEmailId: row.sourceEmailId,
      threadId: row.threadId,
      subject: row.subject,
      receivedAt: row.receivedAt,
      fromAddress: row.fromAddress,
      toAddresses: row.toAddresses,
      contextSnippet,
    };
  });

  const groups = buildProjectMentionQueueGroups(queueRows);
  console.info("[project-mentions:queue]", {
    view,
    rows: rows.length,
    groups: groups.length,
    stats,
    ms: Date.now() - started,
  });
  return {
    view,
    groups,
    stats,
  };
}
