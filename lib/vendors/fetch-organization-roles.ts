import { asc } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationRoleDefinitions } from "@/lib/db/schema";
import {
  ORGANIZATION_ROLE_IDS,
  slugifyOrganizationRoleId,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

export async function fetchCustomOrganizationRoles(): Promise<OrganizationRoleOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: organizationRoleDefinitions.id,
      label: organizationRoleDefinitions.label,
    })
    .from(organizationRoleDefinitions)
    .orderBy(asc(organizationRoleDefinitions.label));

  return rows;
}

export async function getValidOrganizationRoleIds(): Promise<Set<string>> {
  const customRoles = await fetchCustomOrganizationRoles();
  return new Set([
    ...ORGANIZATION_ROLE_IDS,
    ...customRoles.map((role) => role.id),
  ]);
}

export function buildUniqueOrganizationRoleId(
  label: string,
  takenIds: Set<string>,
): string {
  const base = slugifyOrganizationRoleId(label);
  if (!base) return "";

  if (!takenIds.has(base)) return base;

  let suffix = 2;
  while (takenIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}
