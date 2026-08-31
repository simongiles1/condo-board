/**
 * Group project mentions for the Projects Mentions tab.
 * Client-safe: no DB.
 */

import type { ProjectMentionResolutionStatus } from "@/lib/projects/mention-shared";
import { formatToLinePreview } from "@/lib/contacts/mention-queue-shared";

export const PROJECT_MENTION_QUEUE_VIEWS = [
  "unresolved",
  "provisional",
  "confirmed",
] as const;

export type ProjectMentionQueueView =
  (typeof PROJECT_MENTION_QUEUE_VIEWS)[number];

export type ProjectMentionStats = {
  total: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
};

export type ProjectMentionQueueRow = {
  id: string;
  rawName: string;
  contractor: string | null;
  yearHint: string | null;
  phase: string | null;
  location: string | null;
  nameKey: string | null;
  identityKey: string | null;
  fingerprint: string;
  minted: boolean;
  resolutionStatus: ProjectMentionResolutionStatus;
  resolutionReason: string | null;
  resolvedProjectId: string | null;
  resolvedProjectName: string | null;
  resolvedProjectIdentityKey: string | null;
  sourceEmailId: string | null;
  threadId: string | null;
  subject: string | null;
  receivedAt: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  contextSnippet: string | null;
};

export type ProjectMentionQueueSample = {
  mentionId: string;
  rawName: string;
  contractor: string | null;
  yearHint: string | null;
  phase: string | null;
  location: string | null;
  minted: boolean;
  resolutionStatus: ProjectMentionResolutionStatus;
  resolutionReason: string | null;
  resolvedProjectId: string | null;
  resolvedProjectName: string | null;
  resolvedProjectIdentityKey: string | null;
  sourceEmailId: string | null;
  threadId: string | null;
  subject: string | null;
  receivedAt: string | null;
  fromAddress: string | null;
  toPreview: string | null;
  contextSnippet: string | null;
};

export type ProjectMentionQueueGroup = {
  id: string;
  key: string;
  label: string;
  mentionCount: number;
  emailCount: number;
  mintedCount: number;
  samples: ProjectMentionQueueSample[];
};

function statusFromValue(value: string): ProjectMentionResolutionStatus {
  if (value === "confirmed" || value === "provisional") return value;
  return "unresolved";
}

export function parseProjectMentionQueueView(
  value: string | null | undefined,
): ProjectMentionQueueView {
  if (value === "provisional" || value === "confirmed" || value === "unresolved") {
    return value;
  }
  return "unresolved";
}

function groupKey(row: ProjectMentionQueueRow): string {
  return row.nameKey?.trim() || row.fingerprint || row.id;
}

function toSample(row: ProjectMentionQueueRow): ProjectMentionQueueSample {
  return {
    mentionId: row.id,
    rawName: row.rawName,
    contractor: row.contractor,
    yearHint: row.yearHint,
    phase: row.phase,
    location: row.location,
    minted: row.minted,
    resolutionStatus: statusFromValue(row.resolutionStatus),
    resolutionReason: row.resolutionReason,
    resolvedProjectId: row.resolvedProjectId,
    resolvedProjectName: row.resolvedProjectName,
    resolvedProjectIdentityKey: row.resolvedProjectIdentityKey,
    sourceEmailId: row.sourceEmailId,
    threadId: row.threadId,
    subject: row.subject,
    receivedAt: row.receivedAt,
    fromAddress: row.fromAddress,
    toPreview: formatToLinePreview(row.toAddresses),
    contextSnippet: row.contextSnippet,
  };
}

function compareReceivedAtDesc(
  a: ProjectMentionQueueRow,
  b: ProjectMentionQueueRow,
): number {
  const left = a.receivedAt ?? "";
  const right = b.receivedAt ?? "";
  if (left !== right) return right.localeCompare(left);
  return b.id.localeCompare(a.id);
}

export function buildProjectMentionQueueGroups(
  rows: ProjectMentionQueueRow[],
): ProjectMentionQueueGroup[] {
  const buckets = new Map<string, ProjectMentionQueueRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const groups: ProjectMentionQueueGroup[] = [];
  for (const [key, members] of buckets) {
    const emailIds = new Set(
      members
        .map((row) => row.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    );
    const named =
      members.find((row) => row.rawName.trim())?.rawName.trim() || key;
    const sorted = [...members].sort(compareReceivedAtDesc);
    groups.push({
      id: key,
      key,
      label: named,
      mentionCount: members.length,
      emailCount: emailIds.size,
      mintedCount: members.filter((row) => row.minted).length,
      samples: sorted.map(toSample),
    });
  }

  groups.sort(
    (a, b) =>
      b.mentionCount - a.mentionCount ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
  return groups;
}
