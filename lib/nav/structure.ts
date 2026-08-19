import type { UserRole } from "@/lib/auth/roles";

export const NAV_COLLAPSED_COOKIE = "condo-nav-collapsed";

export type NavLink = {
  href: string;
  label: string;
  minRole: UserRole;
  /** Path prefix used for active matching (defaults to href). */
  matchPrefix?: string;
};

export type SubNavTab = {
  href: string;
  label: string;
  children?: SubNavTab[];
};

export type NavSectionId =
  | "overview"
  | "operations"
  | "knowledge"
  | "building"
  | "insights"
  | "dev-tools"
  | "system-admin";

export type NavIconName =
  | "home"
  | "clipboard-check"
  | "book-open"
  | "building"
  | "trending-up"
  | "code"
  | "shield";

export type SidebarSection = {
  id: NavSectionId;
  href: string;
  label: string;
  category: string;
  icon: NavIconName;
  minRole: UserRole;
  matchPrefix?: string;
  tone?: "default" | "admin";
  children?: SubNavTab[];
};

export const ENTITY_KIND_VALUES = [
  "contacts",
  "organizations",
  "projects",
  "equipment",
  "mailboxes",
] as const;

export type EntityKindTab = (typeof ENTITY_KIND_VALUES)[number];

export const DEFAULT_ENTITY_KIND: EntityKindTab = "contacts";

export const ENTITY_KIND_TABS: SubNavTab[] = [
  { href: "/knowledge/entities?tab=contacts", label: "Contacts" },
  { href: "/knowledge/entities?tab=organizations", label: "Organizations" },
  { href: "/knowledge/entities?tab=projects", label: "Projects" },
  { href: "/knowledge/entities?tab=equipment", label: "Equipment" },
  { href: "/knowledge/entities?tab=mailboxes", label: "Shared mailboxes" },
];

export const PRIMARY_NAV: NavLink[] = [
  { href: "/", label: "Overview", minRole: "user", matchPrefix: "/" },
  {
    href: "/operations/meetings",
    label: "Operations",
    minRole: "user",
    matchPrefix: "/operations",
  },
  {
    href: "/knowledge/entities",
    label: "Knowledge",
    minRole: "user",
    matchPrefix: "/knowledge",
  },
  {
    href: "/building/overview",
    label: "Building",
    minRole: "user",
    matchPrefix: "/building",
  },
  {
    href: "/insights/queue",
    label: "Insights",
    minRole: "user",
    matchPrefix: "/insights",
  },
];

export const ADMIN_NAV: NavLink[] = [
  {
    href: "/admin/concepts",
    label: "Dev Tools",
    minRole: "admin",
    matchPrefix: "/admin",
  },
  {
    href: "/admin/system/users",
    label: "System Admin",
    minRole: "super_admin",
    matchPrefix: "/admin/system",
  },
];

export const OPERATIONS_SUBNAV: SubNavTab[] = [
  { href: "/operations/meetings", label: "Meetings" },
  { href: "/operations/todos", label: "Global To-Dos" },
  { href: "/operations/calendar", label: "Unified Calendar" },
];

export const KNOWLEDGE_SUBNAV: SubNavTab[] = [
  {
    href: "/knowledge/entities",
    label: "Entities Registry",
    children: [
      ...ENTITY_KIND_TABS,
      { href: "/knowledge/entities/mention-rules", label: "How mentions match" },
    ],
  },
  { href: "/knowledge/emails", label: "Synced Emails" },
  { href: "/knowledge/files", label: "Document Library" },
];

export const BUILDING_SUBNAV: SubNavTab[] = [
  { href: "/building/overview", label: "Asset Overview & 3D" },
  { href: "/building/maintenance", label: "Maintenance History" },
  { href: "/building/budget", label: "Budget & Financials" },
];

export const INSIGHTS_SUBNAV: SubNavTab[] = [
  { href: "/insights/queue", label: "Extraction Review Queue" },
  { href: "/insights/analytics", label: "Operational Analytics" },
  { href: "/insights/audit", label: "Source Audits" },
];

export const DEV_TOOLS_SUBNAV: SubNavTab[] = [
  { href: "/admin/concepts", label: "Extraction Concepts" },
  { href: "/admin/analysis", label: "Analysis Lab" },
  { href: "/admin/notes", label: "Dev Notes" },
];

export const USERS_ADMIN_TAB_VALUES = ["users", "roles"] as const;

export type UsersAdminTab = (typeof USERS_ADMIN_TAB_VALUES)[number];

export const DEFAULT_USERS_ADMIN_TAB: UsersAdminTab = "users";

export const USERS_ADMIN_TABS: SubNavTab[] = [
  { href: "/admin/system/users?tab=users", label: "Users" },
  { href: "/admin/system/users?tab=roles", label: "User Roles" },
];

export const SYSTEM_ADMIN_SUBNAV: SubNavTab[] = [
  {
    href: "/admin/system/users",
    label: "Users",
    children: USERS_ADMIN_TABS,
  },
  { href: "/admin/system/settings", label: "Email & Sync Settings" },
];

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: "overview",
    href: "/",
    label: "Overview",
    category: "Dashboard",
    icon: "home",
    minRole: "user",
    matchPrefix: "/",
  },
  {
    id: "operations",
    href: "/operations/meetings",
    label: "Operations",
    category: "Board Operations",
    icon: "clipboard-check",
    minRole: "user",
    matchPrefix: "/operations",
    children: OPERATIONS_SUBNAV,
  },
  {
    id: "knowledge",
    href: "/knowledge/entities",
    label: "Knowledge",
    category: "Knowledge Base",
    icon: "book-open",
    minRole: "user",
    matchPrefix: "/knowledge",
    children: KNOWLEDGE_SUBNAV,
  },
  {
    id: "building",
    href: "/building/overview",
    label: "Building",
    category: "Property",
    icon: "building",
    minRole: "user",
    matchPrefix: "/building",
    children: BUILDING_SUBNAV,
  },
  {
    id: "insights",
    href: "/insights/queue",
    label: "Insights",
    category: "Insights",
    icon: "trending-up",
    minRole: "user",
    matchPrefix: "/insights",
    children: INSIGHTS_SUBNAV,
  },
  {
    id: "dev-tools",
    href: "/admin/concepts",
    label: "Dev Tools",
    category: "Developer",
    icon: "code",
    minRole: "admin",
    matchPrefix: "/admin",
    tone: "admin",
    children: DEV_TOOLS_SUBNAV,
  },
  {
    id: "system-admin",
    href: "/admin/system/users",
    label: "System Admin",
    category: "System",
    icon: "shield",
    minRole: "super_admin",
    matchPrefix: "/admin/system",
    tone: "admin",
    children: SYSTEM_ADMIN_SUBNAV,
  },
];

export function parseEntityKindTab(value: unknown): EntityKindTab {
  if (
    typeof value === "string" &&
    (ENTITY_KIND_VALUES as readonly string[]).includes(value)
  ) {
    return value as EntityKindTab;
  }
  return DEFAULT_ENTITY_KIND;
}

export function parseUsersAdminTab(value: unknown): UsersAdminTab {
  if (
    typeof value === "string" &&
    (USERS_ADMIN_TAB_VALUES as readonly string[]).includes(value)
  ) {
    return value as UsersAdminTab;
  }
  return DEFAULT_USERS_ADMIN_TAB;
}

export function splitNavHref(href: string): {
  pathname: string;
  tab: string | null;
} {
  const queryIndex = href.indexOf("?");
  if (queryIndex === -1) {
    return { pathname: href, tab: null };
  }
  return {
    pathname: href.slice(0, queryIndex),
    tab: new URLSearchParams(href.slice(queryIndex + 1)).get("tab"),
  };
}

export function isNavLinkActive(pathname: string, link: NavLink): boolean {
  const prefix = link.matchPrefix ?? link.href;

  if (link.href === "/" || prefix === "/") {
    return pathname === "/";
  }

  // Dev Tools should not stay active on System Admin routes.
  if (prefix === "/admin") {
    return (
      pathname.startsWith("/admin/") && !pathname.startsWith("/admin/system")
    );
  }

  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isSidebarSectionActive(
  pathname: string,
  section: SidebarSection,
): boolean {
  return isNavLinkActive(pathname, {
    href: section.href,
    label: section.label,
    minRole: section.minRole,
    matchPrefix: section.matchPrefix,
  });
}

type QueryReader = { get(name: string): string | null };

export function isSubNavTabActive(
  pathname: string,
  tab: SubNavTab,
  query?: QueryReader | null,
): boolean {
  const { pathname: tabPath, tab: tabQuery } = splitNavHref(tab.href);

  if (tabQuery) {
    if (pathname !== tabPath) {
      return false;
    }
    if (tabPath === "/admin/system/users") {
      return parseUsersAdminTab(query?.get("tab")) === tabQuery;
    }
    return parseEntityKindTab(query?.get("tab")) === tabQuery;
  }

  if (tabPath === "/admin/analysis") {
    return (
      pathname === "/admin/analysis" || pathname.startsWith("/admin/analysis/")
    );
  }
  if (tabPath === "/operations/meetings") {
    return (
      pathname === "/operations/meetings" ||
      pathname.startsWith("/operations/meetings/")
    );
  }
  if (tabPath === "/knowledge/emails") {
    return (
      pathname === "/knowledge/emails" ||
      pathname.startsWith("/knowledge/emails/")
    );
  }
  return pathname === tabPath || pathname.startsWith(`${tabPath}/`);
}

export function matchSection(pathname: string): NavSectionId | null {
  if (pathname === "/") return "overview";
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/building")) return "building";
  if (pathname.startsWith("/insights")) return "insights";
  if (pathname.startsWith("/admin/system")) return "system-admin";
  if (pathname.startsWith("/admin")) return "dev-tools";
  return null;
}

export function subNavForPath(pathname: string): SubNavTab[] | null {
  switch (matchSection(pathname)) {
    case "operations":
      return OPERATIONS_SUBNAV;
    case "knowledge":
      return KNOWLEDGE_SUBNAV;
    case "building":
      return BUILDING_SUBNAV;
    case "insights":
      return INSIGHTS_SUBNAV;
    case "dev-tools":
      return DEV_TOOLS_SUBNAV;
    case "system-admin":
      return SYSTEM_ADMIN_SUBNAV;
    default:
      return null;
  }
}
