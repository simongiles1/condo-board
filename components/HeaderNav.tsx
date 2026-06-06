"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/meetings", label: "Meetings" },
  { href: "/todos", label: "Todos" },
  { href: "/calendar", label: "Calendar" },
  { href: "/emails", label: "Emails" },
  { href: "/extractions", label: "Extractions" },
  { href: "/files", label: "Files" },
  { href: "/building", label: "Building" },
  { href: "/insights", label: "Insights" },
  { href: "/skill", label: "Skill" },
  { href: "/analysis", label: "Analysis" },
  { href: "/notes", label: "Notes" },
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
  if (href === "/extractions") {
    return pathname === "/extractions" || pathname.startsWith("/extractions/");
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
  return pathname === href;
}

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 text-sm font-medium">
      {links.map(({ href, label }) => {
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
