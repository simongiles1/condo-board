/** Hide non-vendor organizations from the Vendors & contracts extraction audit section. */

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { entityMentions, vendors } from "@/lib/db/schema";
import { entitiesMatch, normalizeOrgName } from "@/lib/email/entity-dedup";
import type { ExtractionAuditDestinationGroup } from "@/lib/email/extraction-audit";
import { belongsInVendorDirectory } from "@/lib/vendors/organization-roles";

export type ApprovedOrgRoleEntry = {
  name: string;
  organizationRole: string | null;
  vendorCandidate: boolean;
};

function orgLike(name: string) {
  return { type: "org" as const, value: name };
}

export function resolveApprovedOrganizationRole(
  orgName: string,
  approvedOrgs: ApprovedOrgRoleEntry[],
): ApprovedOrgRoleEntry | undefined {
  const trimmed = orgName.trim();
  if (!trimmed) return undefined;

  for (const entry of approvedOrgs) {
    if (entitiesMatch(orgLike(trimmed), orgLike(entry.name))) {
      return entry;
    }
  }

  return undefined;
}

export async function loadApprovedOrganizationRoles(): Promise<ApprovedOrgRoleEntry[]> {
  const db = getDb();
  const byKey = new Map<string, ApprovedOrgRoleEntry>();

  const addEntry = (entry: ApprovedOrgRoleEntry) => {
    const key = normalizeOrgName(entry.name);
    if (!key) return;
    byKey.set(key, entry);
  };

  const orgMentions = await db
    .select({
      entityValue: entityMentions.entityValue,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
    })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.reviewStatus, "approved"),
        eq(entityMentions.entityType, "org"),
      ),
    );

  for (const row of orgMentions) {
    addEntry({
      name: row.entityValue,
      organizationRole: row.organizationRole,
      vendorCandidate: row.vendorCandidate,
    });
  }

  const vendorRows = await db
    .select({
      name: vendors.name,
      organizationRole: vendors.organizationRole,
    })
    .from(vendors)
    .where(eq(vendors.reviewStatus, "approved"));

  for (const row of vendorRows) {
    const existing = resolveApprovedOrganizationRole(row.name, [...byKey.values()]);
    if (existing) continue;
    addEntry({
      name: row.name,
      organizationRole: row.organizationRole,
      vendorCandidate: belongsInVendorDirectory(row.organizationRole),
    });
  }

  const linkedPersonRows = await db
    .select({
      linkedOrganizationName: entityMentions.linkedOrganizationName,
    })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.reviewStatus, "approved"),
        eq(entityMentions.entityType, "person"),
        isNotNull(entityMentions.linkedOrganizationName),
      ),
    );

  for (const row of linkedPersonRows) {
    const linkedName = row.linkedOrganizationName?.trim();
    if (!linkedName) continue;

    const linkedOrg = resolveApprovedOrganizationRole(linkedName, [...byKey.values()]);
    if (linkedOrg) {
      addEntry({
        name: linkedName,
        organizationRole: linkedOrg.organizationRole,
        vendorCandidate: linkedOrg.vendorCandidate,
      });
    }
  }

  return [...byKey.values()];
}

export function shouldShowInVendorDestination(
  orgName: string,
  approvedOrgs: ApprovedOrgRoleEntry[],
): boolean {
  const match = resolveApprovedOrganizationRole(orgName, approvedOrgs);
  if (!match) return true;
  return belongsInVendorDirectory(match.organizationRole);
}

function contractVendorName(summary: string): string {
  const match = summary.match(/^(.+?)\s+\([^)]+\)$/);
  return (match?.[1] ?? summary).trim();
}

export function filterVendorDestinationGroups(
  groups: ExtractionAuditDestinationGroup[],
  approvedOrgs: ApprovedOrgRoleEntry[],
): ExtractionAuditDestinationGroup[] {
  return groups
    .map((group) => {
      if (group.destination.id !== "vendors") return group;

      const items = group.items.filter((item) => {
        if (item.fieldKey === "vendors") {
          return shouldShowInVendorDestination(item.summary, approvedOrgs);
        }
        if (item.fieldKey === "contracts") {
          return shouldShowInVendorDestination(
            contractVendorName(item.summary),
            approvedOrgs,
          );
        }
        return true;
      });

      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);
}
