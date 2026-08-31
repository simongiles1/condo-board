/** Load Wikipedia org emails from resolved organization_mentions. */

import { and, desc, eq, inArray } from "drizzle-orm";

import { bodyPreviewAroundMention } from "@/lib/contacts/registry-evidence-shared";
import { resolveAuthoredBodiesForEvidence } from "@/lib/contacts/registry-evidence";
import { getDb } from "@/lib/db";
import {
  contactMentions,
  contactPersons,
  emails,
  organizationEntities,
  organizationMentions,
} from "@/lib/db/schema";
import { personDisplayName } from "@/lib/contacts/registry-shared";
import { uniqueByCanonicalOrgName } from "@/lib/organizations/org-name-fuzzy";
import {
  parseJsonIdList,
  tallyResolvedOrgMentionEmails,
  type OrgMentionEmailTallies,
} from "@/lib/organizations/mention-shared";
import {
  ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
  ORG_EVIDENCE_MAX_PAGE_SIZE,
  type OrgEvidencePayload,
} from "@/lib/organizations/registry-evidence-shared";

async function resolveEntityId(organizationIdOrKey: string): Promise<string | null> {
  const trimmed = organizationIdOrKey.trim();
  if (!trimmed) return null;
  const db = getDb();
  const [byId] = await db
    .select({
      id: organizationEntities.id,
      status: organizationEntities.status,
      mergedIntoId: organizationEntities.mergedIntoId,
    })
    .from(organizationEntities)
    .where(eq(organizationEntities.id, trimmed))
    .limit(1);
  if (byId) {
    if (byId.status === "merged" && byId.mergedIntoId) {
      return resolveEntityId(byId.mergedIntoId);
    }
    return byId.id;
  }
  const [byKey] = await db
    .select({
      id: organizationEntities.id,
      status: organizationEntities.status,
      mergedIntoId: organizationEntities.mergedIntoId,
    })
    .from(organizationEntities)
    .where(eq(organizationEntities.identityKey, trimmed))
    .limit(1);
  if (!byKey) return null;
  if (byKey.status === "merged" && byKey.mergedIntoId) {
    return resolveEntityId(byKey.mergedIntoId);
  }
  return byKey.id;
}

function previewAroundOffsets(
  text: string,
  start: number,
  end: number,
): string {
  const pad = 90;
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, end + pad);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

export async function loadOrgMentionEvidence(params: {
  organizationId: string;
  organizationName?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<OrgEvidencePayload | null> {
  const entityId = await resolveEntityId(params.organizationId);
  if (!entityId) return null;

  const pageSize = Math.min(
    ORG_EVIDENCE_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? ORG_EVIDENCE_DEFAULT_PAGE_SIZE) || ORG_EVIDENCE_DEFAULT_PAGE_SIZE),
  );
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1);

  const db = getDb();
  const mentionRows = await db
    .select({
      sourceEmailId: organizationMentions.sourceEmailId,
      rawName: organizationMentions.rawName,
      startOffset: organizationMentions.startOffset,
      endOffset: organizationMentions.endOffset,
    })
    .from(organizationMentions)
    .where(
      and(
        eq(organizationMentions.resolvedOrganizationId, entityId),
        inArray(organizationMentions.resolutionStatus, [
          "confirmed",
          "provisional",
        ]),
      ),
    );

  const emailIds = [
    ...new Set(
      mentionRows
        .map((row) => row.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const mentionByEmail = new Map<
    string,
    { rawName: string; start: number | null; end: number | null }
  >();
  for (const row of mentionRows) {
    if (!row.sourceEmailId) continue;
    const current = mentionByEmail.get(row.sourceEmailId);
    if (!current || (current.start == null && row.startOffset != null)) {
      mentionByEmail.set(row.sourceEmailId, {
        rawName: row.rawName,
        start: row.startOffset,
        end: row.endOffset,
      });
    }
  }

  if (emailIds.length === 0) {
    return {
      field: "name",
      value: params.organizationName?.trim() || params.organizationId,
      organization: {
        id: entityId,
        displayName: params.organizationName?.trim() || params.organizationId,
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
    .where(inArray(emails.id, emailIds))
    .orderBy(desc(emails.receivedAt));

  const authored = await resolveAuthoredBodiesForEvidence(rows);
  const summaries = rows.map((row) => {
    const text = authored.get(row.id) ?? row.bodyText;
    const mention = mentionByEmail.get(row.id);
    const hasOffsets =
      mention != null &&
      mention.start != null &&
      mention.end != null &&
      mention.end > mention.start;
    const surface = hasOffsets
      ? text.slice(mention.start!, mention.end!)
      : "";
    return {
      id: row.id,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      preview: hasOffsets
        ? previewAroundOffsets(text, mention.start!, mention.end!)
        : bodyPreviewAroundMention({
            text,
            needles: mention?.rawName ? [mention.rawName] : [],
          }),
      matchReasons: ["fingerprint" as const],
      highlightNeedles: surface.trim() ? [surface] : [],
    };
  });

  const matchedCount = summaries.length;
  const totalPages = Math.max(1, Math.ceil(matchedCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    field: "name",
    value: params.organizationName?.trim() || params.organizationId,
    organization: {
      id: entityId,
      displayName: params.organizationName?.trim() || params.organizationId,
    },
    emails: summaries.slice(start, start + pageSize),
    matchedCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function loadResolvedOrgMentionEmailCounts(): Promise<OrgMentionEmailTallies> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: organizationMentions.resolvedOrganizationId,
      nameKey: organizationMentions.nameKey,
      sourceEmailId: organizationMentions.sourceEmailId,
    })
    .from(organizationMentions)
    .where(
      inArray(organizationMentions.resolutionStatus, [
        "confirmed",
        "provisional",
      ]),
    );

  return tallyResolvedOrgMentionEmails(rows);
}

export async function loadHarvestMentionsForEmail(emailId: string): Promise<{
  org: Array<{
    id: string;
    rawName: string;
    start: number | null;
    end: number | null;
    status: string;
    resolvedOrganizationId: string | null;
    candidates: Array<{ id: string; name: string }>;
  }>;
  contact: Array<{
    id: string;
    rawName: string;
    start: number | null;
    end: number | null;
    status: string;
    resolvedPersonId: string | null;
    candidates: Array<{ id: string; name: string }>;
  }>;
}> {
  const db = getDb();
  const orgRows = await db
    .select()
    .from(organizationMentions)
    .where(eq(organizationMentions.sourceEmailId, emailId));

  const orgIds = [
    ...new Set(
      orgRows.flatMap((row) => [
        row.resolvedOrganizationId,
        ...parseJsonIdList(row.candidateOrganizationIdsJson),
      ]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const orgNameById = new Map<string, string>();
  if (orgIds.length > 0) {
    const names = await db
      .select({
        id: organizationEntities.id,
        name: organizationEntities.name,
      })
      .from(organizationEntities)
      .where(inArray(organizationEntities.id, orgIds));
    for (const row of names) {
      orgNameById.set(row.id, row.name?.trim() || row.id);
    }
  }

  const contactRows = await db
    .select()
    .from(contactMentions)
    .where(eq(contactMentions.sourceEmailId, emailId));

  const personIds = [
    ...new Set(
      contactRows
        .flatMap((row) => [
          row.resolvedPersonId,
          ...parseJsonIdList(row.candidatePersonIdsJson),
        ])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const personNameById = new Map<string, string>();
  if (personIds.length > 0) {
    const people = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));
    for (const person of people) {
      personNameById.set(
        person.id,
        personDisplayName({
          firstName: person.firstName,
          lastName: person.lastName,
        }),
      );
    }
  }

  return {
    org: orgRows.map((row) => {
      const candidateIds = parseJsonIdList(row.candidateOrganizationIdsJson);
      return {
        id: row.id,
        rawName: row.rawName,
        start: row.startOffset,
        end: row.endOffset,
        status: row.resolutionStatus,
        resolvedOrganizationId: row.resolvedOrganizationId,
        candidates: uniqueByCanonicalOrgName(
          candidateIds.map((id) => ({
            id,
            name: orgNameById.get(id) ?? id,
          })),
        ),
      };
    }),
    contact: contactRows.map((row) => {
      const candidateIds = parseJsonIdList(row.candidatePersonIdsJson);
      const rawName = [row.firstName, row.lastName]
        .map((part) => part?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      return {
        id: row.id,
        rawName,
        start: row.startOffset,
        end: row.endOffset,
        status: row.resolutionStatus,
        resolvedPersonId: row.resolvedPersonId,
        candidates: candidateIds.map((id) => ({
          id,
          name: personNameById.get(id) ?? id,
        })),
      };
    }),
  };
}

export { parseJsonIdList };
