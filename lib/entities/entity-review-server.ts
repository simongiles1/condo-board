/** Server-only entity review queries (uses pg via drizzle). */

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { entityMentions, extractionSources } from "@/lib/db/schema";
import {
  buildEntityReviewGroups,
  splitGroupsForReview,
  type EntityMentionRow,
  type ThreadEntityReviewGroup,
} from "@/lib/entities/entity-review";
import { enrichEntityReviewGroupsWithThreadContext } from "@/lib/entities/entity-context-enrichment";

export async function buildThreadEntityReviewGroups(
  threadId: string,
): Promise<ThreadEntityReviewGroup[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      reviewStatus: entityMentions.reviewStatus,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
      dedupKey: entityMentions.dedupKey,
      personTitle: entityMentions.personTitle,
      linkedOrganizationName: entityMentions.linkedOrganizationName,
      contactEmail: entityMentions.contactEmail,
      sourceId: entityMentions.sourceId,
    })
    .from(entityMentions)
    .innerJoin(
      extractionSources,
      eq(entityMentions.sourceId, extractionSources.id),
    )
    .where(
      and(
        eq(extractionSources.emailThreadId, threadId),
        inArray(entityMentions.reviewStatus, ["pending", "approved"]),
      ),
    );

  const mentionRows = rows as EntityMentionRow[];
  if (!mentionRows.length) return [];

  const pendingGroups = await enrichEntityReviewGroupsWithThreadContext(
    splitGroupsForReview(
      buildEntityReviewGroups(
        mentionRows.filter((row) => row.reviewStatus === "pending"),
      ),
    ),
    mentionRows,
  );

  const approvedGroups = await enrichEntityReviewGroupsWithThreadContext(
    buildEntityReviewGroups(
      mentionRows.filter((row) => row.reviewStatus === "approved"),
    ),
    mentionRows,
  );

  return [
    ...approvedGroups.map((group) => ({
      ...group,
      reviewStatus: "approved" as const,
    })),
    ...pendingGroups.map((group) => ({
      ...group,
      reviewStatus: "pending" as const,
    })),
  ];
}
