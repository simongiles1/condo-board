/** Load organization-registry field evidence emails for the side panel. */

import { desc, ilike, inArray, or } from "drizzle-orm";

import { bodyPreviewAroundMention } from "@/lib/contacts/registry-evidence-shared";
import { getDb } from "@/lib/db";
import {
  emails,
  organizationHighlightExtractions,
} from "@/lib/db/schema";
import { extractMailboxEmail } from "@/lib/email/address-display";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";
import {
  parseOrgFingerprintJson,
  parseOrgHighlightJson,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  findCaseInsensitiveRanges,
  headerReasonsForOrgEmail,
  isOrgEvidenceField,
  orgCardMatchesEvidenceValue,
  orgHighlightMatchesEvidenceValue,
  splitOrgEvidenceNeedles,
  type OrgEvidenceEmailSummary,
  type OrgEvidenceField,
  type OrgEvidenceMatchReason,
  type OrgEvidencePayload,
  ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
  ORG_EVIDENCE_MAX_PAGE_SIZE,
} from "@/lib/organizations/registry-evidence-shared";

export type {
  OrgEvidenceEmailSummary,
  OrgEvidenceField,
  OrgEvidenceMatchReason,
  OrgEvidencePayload,
} from "@/lib/organizations/registry-evidence-shared";

export {
  ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
  ORG_EVIDENCE_MAX_PAGE_SIZE,
  isOrgEvidenceField,
} from "@/lib/organizations/registry-evidence-shared";

const MAX_CANDIDATE_EMAILS = 2000;

function escapeIlikeNeedle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, " ");
}

function parseAddressJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function addReasons(
  byEmail: Map<string, Set<OrgEvidenceMatchReason>>,
  emailId: string,
  reasons: OrgEvidenceMatchReason[],
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
    const stored = row.bodyTextStrictUnique?.trim() || row.bodyTextUnique?.trim();
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

export async function loadOrgFieldEvidence(params: {
  organizationId: string;
  organizationName?: string | null;
  field: string;
  value: string;
  page?: number;
  pageSize?: number;
}): Promise<OrgEvidencePayload | null> {
  if (!isOrgEvidenceField(params.field)) return null;
  const field = params.field;
  const value = params.value.trim();
  const organizationId = params.organizationId.trim();
  if (!organizationId || !value) return null;

  const pageSize = Math.min(
    ORG_EVIDENCE_MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.floor(params.pageSize ?? ORG_EVIDENCE_DEFAULT_PAGE_SIZE) ||
        ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
    ),
  );
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1);
  const needles = splitOrgEvidenceNeedles(field, value);
  const ilikeNeedle = escapeIlikeNeedle(needles[0] ?? value);
  if (!ilikeNeedle) return null;

  const db = getDb();
  const byEmail = new Map<string, Set<OrgEvidenceMatchReason>>();
  const like = `%${ilikeNeedle}%`;

  const extractionRows = await db
    .select({
      emailId: organizationHighlightExtractions.emailId,
      extractionJson: organizationHighlightExtractions.extractionJson,
      secondPassExtractionJson:
        organizationHighlightExtractions.secondPassExtractionJson,
      thirdPassExtractionJson:
        organizationHighlightExtractions.thirdPassExtractionJson,
    })
    .from(organizationHighlightExtractions)
    .where(
      or(
        ilike(organizationHighlightExtractions.thirdPassExtractionJson, like),
        ilike(organizationHighlightExtractions.extractionJson, like),
        ilike(
          organizationHighlightExtractions.secondPassExtractionJson,
          like,
        ),
      ),
    )
    .limit(MAX_CANDIDATE_EMAILS);

  for (const row of extractionRows) {
    if (row.thirdPassExtractionJson) {
      const parsed = parseOrgFingerprintJson(row.thirdPassExtractionJson);
      if (
        parsed.entity_cards.some((card) =>
          orgCardMatchesEvidenceValue(card, field, value),
        )
      ) {
        addReasons(byEmail, row.emailId, ["fingerprint"]);
      }
    }
    const first = parseOrgHighlightJson(row.extractionJson ?? "");
    const second = parseOrgHighlightJson(row.secondPassExtractionJson ?? "");
    if (
      orgHighlightMatchesEvidenceValue(first, field, value) ||
      orgHighlightMatchesEvidenceValue(second, field, value)
    ) {
      addReasons(byEmail, row.emailId, ["highlight"]);
    }
  }

  const candidateIds = [...byEmail.keys()];
  if (candidateIds.length === 0) {
    return {
      field,
      value,
      organization: {
        id: organizationId,
        displayName: params.organizationName?.trim() || organizationId,
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
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
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
  const summaries: OrgEvidenceEmailSummary[] = [];
  for (const row of rows) {
    const body = authored.get(row.id) ?? row.bodyText;
    const reasons = new Set(byEmail.get(row.id) ?? []);
    const toAddresses = parseAddressJson(row.toAddresses);
    const ccAddresses = parseAddressJson(row.ccAddresses);
    for (const needle of needles) {
      for (const reason of headerReasonsForOrgEmail(field, needle, {
        fromAddress: row.fromAddress,
        toAddresses,
        ccAddresses,
      })) {
        reasons.add(reason);
      }
      if (findCaseInsensitiveRanges(body, needle).length > 0) {
        reasons.add("in_body");
      }
      const mailbox = extractMailboxEmail(row.fromAddress);
      if (
        field === "email" &&
        mailbox &&
        mailbox.toLowerCase() === needle.toLowerCase()
      ) {
        reasons.add("email_from");
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
    organization: {
      id: organizationId,
      displayName: params.organizationName?.trim() || organizationId,
    },
    emails: summaries.slice(start, start + pageSize),
    matchedCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}
