"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { hasMinRole, type UserRole } from "@/lib/auth/roles";

const links = [
  { href: "/", label: "Dashboard", minRole: "user" as UserRole },
  { href: "/meetings", label: "Meetings", minRole: "user" as UserRole },
  { href: "/todos", label: "Todos", minRole: "user" as UserRole },
  { href: "/calendar", label: "Calendar", minRole: "user" as UserRole },
  { href: "/emails", label: "Emails", minRole: "user" as UserRole },
  { href: "/files", label: "Files", minRole: "user" as UserRole },
  { href: "/building", label: "Building", minRole: "user" as UserRole },
  { href: "/insights", label: "Insights", minRole: "user" as UserRole },
  { href: "/skill", label: "Concepts", minRole: "admin" as UserRole },
  { href: "/analysis", label: "Analysis", minRole: "admin" as UserRole },
  { href: "/notes", label: "Notes", minRole: "admin" as UserRole },
  { href: "/users", label: "Users", minRole: "super_admin" as UserRole },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/meetings") {
    return pathname === "/meetings" || pathname.startsWith("/meetings/");
  }
  if (href === "/todos") {
    return pathname === "/todos" || pathname.startsWith("/todos/");
  }
  if (href === "/calendar") {
    return pathname === "/calendar" || pathname.startsWith("/calendar/");
  }
  if (href === "/emails") {
    return pathname === "/emails" || pathname.startsWith("/emails/");
  }
  if (href === "/files") {
    return pathname === "/files" || pathname.startsWith("/files/");
  }
  if (href === "/building") {
    return pathname === "/building" || pathname.startsWith("/building/");
  }
  if (href === "/insights") {
    return pathname === "/insights" || pathname.startsWith("/insights/");
  }
  if (href === "/skill") {
    return pathname === "/skill" || pathname.startsWith("/skill/");
  }
  if (href === "/analysis") {
    return pathname === "/analysis" || pathname.startsWith("/analysis/");
  }
  if (href === "/notes") {
    return pathname === "/notes" || pathname.startsWith("/notes/");
  }
  if (href === "/users") {
    return pathname === "/users" || pathname.startsWith("/users/");
  }
  return pathname === href;
}

export function HeaderNav({ role }: { role: UserRole | null }) {
  const pathname = usePathname();
  const visibleLinks = links.filter(
    (link) => role && hasMinRole(role, link.minRole),
  );

  if (!role) return null;

  return (
    <nav className="flex gap-4 text-sm font-medium">
      {visibleLinks.map(({ href, label }) => {
        const active = isActive(pathname, href);

        if (active) {
          return (
            <span
              key={href}
              aria-current="page"
              className="cursor-default font-bold text-slate-900"
            >
              {label}
            </span>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            className="text-slate-700 hover:text-teal-700"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
