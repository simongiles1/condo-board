export const ORGANIZATION_ROLES = [
  { id: "condo_corporation", label: "Condominium corporation" },
  { id: "vendor", label: "Vendor (service provider)" },
  { id: "property_manager", label: "Property manager" },
  { id: "contractor", label: "Contractor" },
  { id: "legal", label: "Legal / professional" },
  { id: "other", label: "Other organization" },
] as const;

export type OrganizationRoleId = (typeof ORGANIZATION_ROLES)[number]["id"];

export type OrganizationRoleOption = {
  id: string;
  label: string;
};

export const ORGANIZATION_ROLE_IDS = new Set<string>(
  ORGANIZATION_ROLES.map((role) => role.id),
);

export const ADD_ORGANIZATION_ROLE_OPTION_VALUE = "__add_new_role__";

export function slugifyOrganizationRoleId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mergeOrganizationRoles(
  customRoles: OrganizationRoleOption[],
): OrganizationRoleOption[] {
  const seen = new Set<string>(ORGANIZATION_ROLES.map((role) => role.id));
  const merged: OrganizationRoleOption[] = ORGANIZATION_ROLES.map((role) => ({
    id: role.id,
    label: role.label,
  }));

  for (const role of customRoles) {
    if (!role.id || !role.label.trim() || seen.has(role.id)) continue;
    merged.push(role);
    seen.add(role.id);
  }

  return merged;
}

export function isValidOrganizationRole(
  role: string | null | undefined,
  customRoleIds?: Set<string>,
): boolean {
  if (!role?.trim()) return false;
  return ORGANIZATION_ROLE_IDS.has(role) || Boolean(customRoleIds?.has(role));
}

export function organizationRoleLabel(
  role: string | null | undefined,
  customRoles?: OrganizationRoleOption[],
): string {
  const builtIn = ORGANIZATION_ROLES.find((entry) => entry.id === role);
  if (builtIn) return builtIn.label;

  const custom = customRoles?.find((entry) => entry.id === role);
  if (custom) return custom.label;

  return role?.replace(/_/g, " ") ?? "Organization";
}

/** Roles that belong in the vendor directory and Vendors & contracts audit section. */
export function belongsInVendorDirectory(role: string | null | undefined): boolean {
  return role === "vendor" || role === "contractor";
}

/** A Toronto Standard Condominium Corporation (TSCC ####) — not an external vendor. */
export function isCondoCorporation(name: string | null | undefined): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return false;

  return (
    /\bTSCC\s*\d+\b/i.test(trimmed) ||
    /\bToronto Standard Condominium Corporation(?:\s+No\.?)?\s*\d+\b/i.test(trimmed)
  );
}
