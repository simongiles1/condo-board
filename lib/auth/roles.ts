export const USER_ROLES = ["super_admin", "admin", "user"] as const;

export type UserRole = (typeof USER_ROLES)[number];

const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  admin: 1,
  super_admin: 2,
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export function hasMinRole(userRole: UserRole, required: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

/** Routes only super admins may access. */
export const SUPER_ADMIN_ONLY_PREFIXES = [
  "/admin/system",
  "/users",
  "/settings",
  "/api/users",
  "/api/email/clear-all",
  "/api/email/settings",
  "/api/email/allowlist",
  "/api/email/oauth",
  "/api/email/backfill",
  "/api/email/forward",
  "/api/email/sync",
] as const;

/**
 * Routes regular users cannot access. Admins and super admins may.
 * Covers bulk analysis, concept editing, and internal dev notes.
 */
export const ADMIN_ONLY_PREFIXES = [
  "/admin/concepts",
  "/admin/analysis",
  "/admin/notes",
  "/analysis",
  "/skill",
  "/notes",
  "/api/analysis/analyze-all",
  "/api/analysis/purge-processed-data",
  "/api/analysis/re-extract-with-current-skill",
  "/api/analysis/bridge-meetings",
  "/api/analysis/settings",
  "/api/skill",
] as const;

export function pathRequiresSuperAdmin(pathname: string): boolean {
  return SUPER_ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function pathRequiresAdmin(pathname: string): boolean {
  if (pathRequiresSuperAdmin(pathname)) return false;
  // Entire /admin tree except /admin/system (super-admin) requires admin.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin/system" || pathname.startsWith("/admin/system/")) {
      return false;
    }
    return true;
  }
  return ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "Super admin";
    case "admin":
      return "Admin";
    case "user":
      return "User";
  }
}
