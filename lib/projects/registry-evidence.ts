/** Load project-registry field evidence emails for the side panel. */

import { desc, ilike, inArray, or } from "drizzle-orm";

import { bodyPreviewAroundMention } from "@/lib/contacts/registry-evidence-shared";
import { getDb } from "@/lib/db";
import { emails, projectHighlightExtractions } from "@/lib/db/schema";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";
import {
  parseProjectFingerprintJson,
  parseProjectHighlightJson,
} from "@/lib/email-analysis/project-highlight-shared";
import {
  listProjectEvidenceCandidateEmailIds,
  listProjectSourceEmailIds,
  loadProjectFingerprintSummaries,
} from "@/lib/projects/fingerprint-list";
import {
  collectProjectIdentityNeedles,
  collectProjectSourceNeedles,
  emailBelongsInProjectSourceEvidence,
  findCaseInsensitiveRanges,
  isProjectEvidenceField,
  projectCardMatchesEvidenceValue,
  projectHighlightMatchesEvidenceValue,
  splitProjectEvidenceNeedles,
  type ProjectEvidenceEmailSummary,
  type ProjectEvidenceField,
  type ProjectEvidenceMatchReason,
  type ProjectEvidencePayload,
  PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
  PROJECT_EVIDENCE_MAX_PAGE_SIZE,
} from "@/lib/projects/registry-evidence-shared";

export type {
  ProjectEvidenceEmailSummary,
  ProjectEvidenceField,
  ProjectEvidenceMatchReason,
  ProjectEvidencePayload,
} from "@/lib/projects/registry-evidence-shared";

export {
  isProjectEvidenceField,
  PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
  PROJECT_EVIDENCE_MAX_PAGE_SIZE,
} from "@/lib/projects/registry-evidence-shared";

const MAX_CANDIDATE_EMAILS = 2000;

function escapeIlikeNeedle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, " ");
}

function addReasons(
  byEmail: Map<string, Set<ProjectEvidenceMatchReason>>,
  emailId: string,
  reasons: ProjectEvidenceMatchReason[],
): void {
  if (!emailId || reasons.length === 0) return;
  let set = byEmail.get(emailId);
  if (!set) {
    set = new Set();
    byEmail.set(emailId, set);
  }
  for (const reason of reasons) set.add(reason);
}

async function resolveAuthoredBodies(
  rows: Array<{
    id: string;
    threadId: string | null;
    bodyText: string;
    bodyHtml: string | null;
    bodyTextUnique: string | null;
    bodyTextStrictUnique: string | null;
    receivedAt: string;
  }>,
): Promise<Map<string, string>> {
  const authored = new Map<string, string>();
  for (const row of rows) {
    const stored =
      row.bodyTextStrictUnique?.trim() || row.bodyTextUnique?.trim();
    if (stored) authored.set(row.id, stored);
  }
  const needsCompute = rows.filter((row) => !authored.has(row.id));
  if (needsCompute.length === 0) return authored;

  const db = getDb();
  const threadIds = [
    ...new Set(needsCompute.map((row) => row.threadId).filter(Boolean)),
  ] as string[];
  const threadMessages =
    threadIds.length > 0
      ? await db
          .select({
            id: emails.id,
            threadId: emails.threadId,
            bodyText: emails.bodyText,
            bodyHtml: emails.bodyHtml,
            receivedAt: emails.receivedAt,
          })
          .from(emails)
          .where(inArray(emails.threadId, threadIds))
      : [];

  const byThread = new Map<string, typeof threadMessages>();
  for (const msg of threadMessages) {
    if (!msg.threadId) continue;
    const list = byThread.get(msg.threadId) ?? [];
    list.push(msg);
    byThread.set(msg.threadId, list);
  }

  const needIds = new Set(needsCompute.map((row) => row.id));
  for (const [, messages] of byThread) {
    const uniqueMap = computeThreadUniqueBodies(
      messages.map((msg) => ({
        id: msg.id,
        bodyText: msg.bodyText,
        bodyHtml: msg.bodyHtml,
        receivedAt: msg.receivedAt,
      })),
    );
    for (const msg of messages) {
      if (!needIds.has(msg.id) || authored.has(msg.id)) continue;
      authored.set(msg.id, uniqueMap.get(msg.id) ?? msg.bodyText);
    }
  }
  for (const row of needsCompute) {
    if (!authored.has(row.id)) authored.set(row.id, row.bodyText);
  }
  return authored;
}

async function loadProjectSourceEmailEvidence(params: {
  projectId: string;
  projectName?: string | null;
  page: number;
  pageSize: number;
}): Promise<ProjectEvidencePayload> {
  const { projectId, page, pageSize } = params;
  const [{ projects }, attributedIds, candidateIds] = await Promise.all([
    loadProjectFingerprintSummaries({ limit: 2000 }),
    listProjectSourceEmailIds(projectId),
    listProjectEvidenceCandidateEmailIds(projectId),
  ]);
  const project = projects.find((row) => row.id === projectId);
  const displayName =
    project?.displayName || params.projectName?.trim() || projectId;
  const identityNeedles = collectProjectIdentityNeedles({
    name: project?.name,
    aliases: project?.aliases,
  });
  const needles = collectProjectSourceNeedles({
    name: project?.name,
    displayName,
    aliases: project?.aliases,
    phase: project?.phase,
    contractor: project?.contractor,
    location: project?.location,
    equipment_mentions: project?.equipment_mentions,
  });
  const empty: ProjectEvidencePayload = {
    field: "source_emails",
    value: displayName,
    needles: identityNeedles.length > 0 ? identityNeedles : needles,
    project: { id: projectId, displayName },
    emails: [],
    matchedCount: 0,
    page: 1,
    pageSize,
    totalPages: 1,
  };
  const emailIds = [
    ...new Set([...attributedIds, ...candidateIds]),
  ].filter(Boolean);
  if (emailIds.length === 0) return empty;

  const db = getDb();
  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, emailIds.slice(0, MAX_CANDIDATE_EMAILS)))
    .orderBy(desc(emails.receivedAt));

  const authored = await resolveAuthoredBodies(rows);
  const attributedSet = new Set(attributedIds);
  const highlightNeedles =
    identityNeedles.length > 0 ? identityNeedles : needles;
  const summaries: ProjectEvidenceEmailSummary[] = [];
  for (const row of rows) {
    const body = authored.get(row.id) ?? row.bodyText;
    const pass3CardMatches = attributedSet.has(row.id);
    if (
      !emailBelongsInProjectSourceEvidence({
        authoredBody: body,
        pass3CardMatches,
        identityNeedles,
      })
    ) {
      continue;
    }
    const reasons: ProjectEvidenceMatchReason[] = [];
    if (pass3CardMatches) reasons.push("fingerprint");
    if (
      highlightNeedles.some(
        (needle) => findCaseInsensitiveRanges(body, needle).length > 0,
      )
    ) {
      reasons.push("in_body");
    }
    summaries.push({
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: bodyPreviewAroundMention({
        text: body,
        needles: highlightNeedles,
      }),
      matchReasons: reasons,
    });
  }

  const matchedCount = summaries.length;
  const totalPages = Math.max(1, Math.ceil(matchedCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    field: "source_emails",
    value: displayName,
    needles: highlightNeedles,
    project: { id: projectId, displayName },
    emails: summaries.slice(start, start + pageSize),
    matchedCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function loadProjectFieldEvidence(params: {
  projectId: string;
  projectName?: string | null;
  field: string;
  value: string;
  page?: number;
  pageSize?: number;
}): Promise<ProjectEvidencePayload | null> {
  if (!isProjectEvidenceField(params.field)) return null;
  const field = params.field;
  const value = params.value.trim();
  const projectId = params.projectId.trim();
  if (!projectId) return null;
  if (field !== "source_emails" && !value) return null;

  const pageSize = Math.min(
    PROJECT_EVIDENCE_MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.floor(params.pageSize ?? PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE) ||
        PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
    ),
  );
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1);

  if (field === "source_emails") {
    return loadProjectSourceEmailEvidence({
      projectId,
      projectName: params.projectName,
      page,
      pageSize,
    });
  }

  const needles = splitProjectEvidenceNeedles(field, value);
  const ilikeNeedle = escapeIlikeNeedle(needles[0] ?? value);
  if (!ilikeNeedle) return null;

  const db = getDb();
  const byEmail = new Map<string, Set<ProjectEvidenceMatchReason>>();
  const like = `%${ilikeNeedle}%`;

  const extractionRows = await db
    .select({
      emailId: projectHighlightExtractions.emailId,
      extractionJson: projectHighlightExtractions.extractionJson,
      secondPassExtractionJson:
        projectHighlightExtractions.secondPassExtractionJson,
      thirdPassExtractionJson:
        projectHighlightExtractions.thirdPassExtractionJson,
    })
    .from(projectHighlightExtractions)
    .where(
      or(
        ilike(projectHighlightExtractions.thirdPassExtractionJson, like),
        ilike(projectHighlightExtractions.extractionJson, like),
        ilike(projectHighlightExtractions.secondPassExtractionJson, like),
      ),
    )
    .limit(MAX_CANDIDATE_EMAILS);

  for (const row of extractionRows) {
    if (row.thirdPassExtractionJson) {
      const parsed = parseProjectFingerprintJson(row.thirdPassExtractionJson);
      if (
        parsed.entity_cards.some((card) =>
          projectCardMatchesEvidenceValue(card, field, value),
        )
      ) {
        addReasons(byEmail, row.emailId, ["fingerprint"]);
      }
    }
    const first = parseProjectHighlightJson(row.extractionJson ?? "");
    const second = parseProjectHighlightJson(row.secondPassExtractionJson ?? "");
    if (
      projectHighlightMatchesEvidenceValue(first, field, value) ||
      projectHighlightMatchesEvidenceValue(second, field, value)
    ) {
      addReasons(byEmail, row.emailId, ["highlight"]);
    }
  }

  const candidateIds = [...byEmail.keys()];
  if (candidateIds.length === 0) {
    return {
      field,
      value,
      needles,
      project: {
        id: projectId,
        displayName: params.projectName?.trim() || projectId,
      },
      emails: [],
      matchedCount: 0,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, candidateIds))
    .orderBy(desc(emails.receivedAt));

  const authored = await resolveAuthoredBodies(rows);
  const summaries: ProjectEvidenceEmailSummary[] = [];
  for (const row of rows) {
    const body = authored.get(row.id) ?? row.bodyText;
    const reasons = new Set(byEmail.get(row.id) ?? []);
    for (const needle of needles) {
      if (findCaseInsensitiveRanges(body, needle).length > 0) {
        reasons.add("in_body");
      }
    }
    summaries.push({
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: bodyPreviewAroundMention({
        text: body,
        needles,
      }),
      matchReasons: [...reasons],
    });
  }

  const matchedCount = summaries.length;
  const totalPages = Math.max(1, Math.ceil(matchedCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    field,
    value,
    needles,
    project: {
      id: projectId,
      displayName: params.projectName?.trim() || projectId,
    },
    emails: summaries.slice(start, start + pageSize),
    matchedCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}
