"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

function NavLink({
  href,
  label,
  active,
  onNavigate,
  mobile = false,
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  if (active) {
    return (
      <span
        aria-current="page"
        className={
          mobile
            ? "block rounded-md bg-slate-100 px-3 py-2 font-bold text-slate-900"
            : "cursor-default font-bold text-slate-900"
        }
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={
        mobile
          ? "block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-teal-700"
          : "text-slate-700 hover:text-teal-700"
      }
    >
      {label}
    </Link>
  );
}

export function HeaderNav({ role }: { role: UserRole | null }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleLinks = links.filter(
    (link) => role && hasMinRole(role, link.minRole),
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  if (!role) return null;

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <nav className="hidden gap-4 text-sm font-medium md:flex">
        {visibleLinks.map(({ href, label }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            active={isActive(pathname, href)}
          />
        ))}
      </nav>

      <div className="relative md:hidden">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {menuOpen ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <>
                <path strokeLinecap="round" d="M4 7h16" />
                <path strokeLinecap="round" d="M4 12h16" />
                <path strokeLinecap="round" d="M4 17h16" />
              </>
            )}
          </svg>
        </button>

        {menuOpen ? (
          <>
            <button
              type="button"
              aria-label="Close navigation menu"
              className="fixed inset-0 z-40 bg-black/20"
              onClick={closeMenu}
            />
            <nav
              id="mobile-nav-menu"
              className="absolute right-0 top-full z-50 mt-2 max-h-[min(70vh,24rem)] w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium shadow-lg"
            >
              {visibleLinks.map(({ href, label }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  active={isActive(pathname, href)}
                  onNavigate={closeMenu}
                  mobile
                />
              ))}
            </nav>
          </>
        ) : null}
      </div>
    </>
  );
}
