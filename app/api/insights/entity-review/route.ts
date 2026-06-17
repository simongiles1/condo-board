export const runtime = "nodejs";

import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { entityMentions, extractionSources, vendors } from "@/lib/db/schema";
import { entitiesMatch } from "@/lib/email/entity-dedup";
import {
  dedupeExclusionInputs,
  registerEntityExclusions,
  type EntityExclusionInput,
} from "@/lib/entities/entity-exclusions";
import {
  buildEntityDedupKey,
  parseStructuredContactContext,
} from "@/lib/entities/entity-review";
import { getValidOrganizationRoleIds } from "@/lib/vendors/fetch-organization-roles";
import {
  belongsInVendorDirectory,
  isValidOrganizationRole,
} from "@/lib/vendors/organization-roles";

type Payload = {
  mentionIds?: string[];
  personValue?: string;
  orgValue?: string;
  phoneValue?: string;
  emailValue?: string;
  organizationRole?: string;
  linkedOrgName?: string;
  personRole?: string;
  approvalType?: "person" | "organization" | "exclude" | "delete";
};

async function upsertApprovedVendor(name: string, organizationRole: string | null) {
  const db = getDb();
  const normalized = name.trim();
  const [existing] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.name, normalized))
    .limit(1);

  if (existing) {
    await db
      .update(vendors)
      .set({
        reviewStatus: "approved",
        organizationRole: organizationRole ?? existing.organizationRole,
      })
      .where(eq(vendors.id, existing.id));
    return;
  }

  await db.insert(vendors).values({
    id: randomUUID(),
    name: normalized,
    reviewStatus: "approved",
    organizationRole,
    createdAt: new Date().toISOString(),
  });
}

function buildExclusionEntries(input: {
  rows: Array<{ entityType: string; entityValue: string }>;
  personValue?: string;
  orgValue?: string;
  linkedOrgName?: string;
  phoneValue?: string;
  emailValue?: string;
}): EntityExclusionInput[] {
  const entries: EntityExclusionInput[] = [];

  if (input.personValue) {
    entries.push({ entityType: "person", entityValue: input.personValue });
  }
  if (input.orgValue) {
    entries.push({ entityType: "org", entityValue: input.orgValue });
  }
  if (input.linkedOrgName) {
    entries.push({ entityType: "org", entityValue: input.linkedOrgName });
  }
  if (input.phoneValue) {
    entries.push({ entityType: "phone", entityValue: input.phoneValue });
  }
  if (input.emailValue) {
    entries.push({ entityType: "email", entityValue: input.emailValue });
  }

  for (const row of input.rows) {
    if (row.entityType === "person" || row.entityType === "org" || row.entityType === "phone") {
      entries.push({ entityType: row.entityType, entityValue: row.entityValue });
    }
  }

  return dedupeExclusionInputs(entries);
}

async function linkPendingContactsToApprovedOrganization(input: {
  approvedOrgName: string;
  sourceIds: string[];
}): Promise<number> {
  const db = getDb();
  const normalizedOrgName = input.approvedOrgName.trim();
  if (!normalizedOrgName || input.sourceIds.length === 0) return 0;

  const threadIds = new Set<string>();
  for (const sourceId of input.sourceIds) {
    const [source] = await db
      .select({ threadId: extractionSources.emailThreadId })
      .from(extractionSources)
      .where(eq(extractionSources.id, sourceId))
      .limit(1);
    if (source?.threadId) threadIds.add(source.threadId);
  }

  if (threadIds.size === 0) return 0;

  let linked = 0;
  for (const threadId of threadIds) {
    const pendingPersons = await db
      .select({
        id: entityMentions.id,
        entityValue: entityMentions.entityValue,
        context: entityMentions.context,
        linkedOrganizationName: entityMentions.linkedOrganizationName,
      })
      .from(entityMentions)
      .innerJoin(
        extractionSources,
        eq(entityMentions.sourceId, extractionSources.id),
      )
      .where(
        and(
          eq(extractionSources.emailThreadId, threadId),
          eq(entityMentions.reviewStatus, "pending"),
          eq(entityMentions.entityType, "person"),
        ),
      );

    for (const person of pendingPersons) {
      const existingLink = person.linkedOrganizationName?.trim();
      if (
        existingLink &&
        entitiesMatch(
          { type: "org", value: existingLink },
          { type: "org", value: normalizedOrgName },
        )
      ) {
        if (existingLink !== normalizedOrgName) {
          await db
            .update(entityMentions)
            .set({ linkedOrganizationName: normalizedOrgName })
            .where(eq(entityMentions.id, person.id));
          linked += 1;
        }
        continue;
      }

      const parsed = parseStructuredContactContext(
        person.context ?? "",
        person.entityValue,
      );
      const contextOrg = parsed.org?.trim();
      if (
        !contextOrg ||
        !entitiesMatch(
          { type: "org", value: contextOrg },
          { type: "org", value: normalizedOrgName },
        )
      ) {
        continue;
      }

      await db
        .update(entityMentions)
        .set({ linkedOrganizationName: normalizedOrgName })
        .where(eq(entityMentions.id, person.id));
      linked += 1;
    }
  }

  return linked;
}

export async function PATCH(request: Request) {
  const db = getDb();

  try {
    const body = (await request.json()) as Payload;
    const mentionIds = Array.isArray(body.mentionIds)
      ? body.mentionIds.filter((id) => typeof id === "string" && id.trim())
      : [];

    if (mentionIds.length === 0) {
      return NextResponse.json({ error: "mentionIds required" }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(entityMentions)
      .where(inArray(entityMentions.id, mentionIds));

    if (rows.length === 0) {
      return NextResponse.json({ error: "Entity mentions not found" }, { status: 404 });
    }

    const approvalType = body.approvalType;
    const emailValue = body.emailValue?.trim().toLowerCase() || null;

    if (approvalType === "delete") {
      const pendingRows = rows.filter((row) => row.reviewStatus === "pending");
      if (pendingRows.length === 0) {
        return NextResponse.json(
          { error: "Only pending entity mentions can be deleted" },
          { status: 400 },
        );
      }

      for (const row of pendingRows) {
        await db.delete(entityMentions).where(eq(entityMentions.id, row.id));
      }

      return NextResponse.json({ ok: true, deleted: pendingRows.length });
    }

    if (approvalType === "exclude") {
      const exclusionEntries = buildExclusionEntries({
        rows,
        personValue: body.personValue?.trim(),
        orgValue: body.orgValue?.trim(),
        linkedOrgName: body.linkedOrgName?.trim(),
        phoneValue: body.phoneValue?.trim(),
        emailValue: emailValue ?? undefined,
      });

      await registerEntityExclusions(
        exclusionEntries,
        "Ignored during entity review",
      );

      for (const row of rows) {
        await db
          .update(entityMentions)
          .set({ reviewStatus: "excluded", vendorCandidate: false })
          .where(eq(entityMentions.id, row.id));
      }

      return NextResponse.json({
        ok: true,
        excluded: rows.length,
        registered: exclusionEntries.length,
      });
    }

    const validRoleIds = await getValidOrganizationRoleIds();
    const organizationRole =
      typeof body.organizationRole === "string" &&
      isValidOrganizationRole(body.organizationRole, validRoleIds)
        ? body.organizationRole
        : null;

    const linkedOrgName = body.linkedOrgName?.trim() || null;
    const personRole = body.personRole?.trim() || null;
    const phoneValue = body.phoneValue?.trim() || null;

    for (const row of rows) {
      let entityValue = row.entityValue;
      if (row.entityType === "person" && body.personValue?.trim()) {
        entityValue = body.personValue.trim();
      }
      if (row.entityType === "org" && body.orgValue?.trim()) {
        entityValue = body.orgValue.trim();
      }
      if (row.entityType === "phone" && phoneValue) {
        entityValue = phoneValue;
      }

      await db
        .update(entityMentions)
        .set({
          entityValue,
          contactEmail:
            row.entityType === "person" || row.entityType === "org"
              ? emailValue
              : row.contactEmail,
          reviewStatus: "approved",
          organizationRole:
            row.entityType === "org" ? organizationRole : row.organizationRole,
          vendorCandidate: false,
          personTitle: row.entityType === "person" ? personRole : row.personTitle,
          linkedOrganizationName:
            row.entityType === "person" ? linkedOrgName : row.linkedOrganizationName,
          dedupKey: buildEntityDedupKey({
            type: row.entityType,
            value: entityValue,
          }),
        })
        .where(eq(entityMentions.id, row.id));
    }

    const personRow = rows.find((row) => row.entityType === "person");
    const hasPhoneRow = rows.some((row) => row.entityType === "phone");
    if (
      approvalType === "person" &&
      phoneValue &&
      !hasPhoneRow &&
      personRow
    ) {
      await db.insert(entityMentions).values({
        id: randomUUID(),
        entityType: "phone",
        entityValue: phoneValue,
        context: personRow.context,
        contactEmail: emailValue,
        reviewStatus: "approved",
        organizationRole: null,
        vendorCandidate: false,
        personTitle: null,
        linkedOrganizationName: linkedOrgName,
        dedupKey: buildEntityDedupKey({ type: "phone", value: phoneValue }),
        sourceId: personRow.sourceId,
        createdAt: new Date().toISOString(),
      });
    }

    const approvedOrgName = body.orgValue?.trim();
    let organization:
      | { name: string; organizationRole: string | null }
      | undefined;

    if (approvalType === "organization" && approvedOrgName) {
      if (belongsInVendorDirectory(organizationRole)) {
        await upsertApprovedVendor(approvedOrgName, organizationRole);
      } else {
        await db.delete(vendors).where(eq(vendors.name, approvedOrgName));
      }
      organization = {
        name: approvedOrgName,
        organizationRole,
      };

      await linkPendingContactsToApprovedOrganization({
        approvedOrgName,
        sourceIds: [...new Set(rows.map((row) => row.sourceId))],
      });
    }

    return NextResponse.json({
      ok: true,
      approved: rows.length,
      organization,
    });
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload" }, { status: 400 });
  }
}
