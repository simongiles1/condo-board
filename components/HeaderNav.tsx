"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { hasMinRole, type UserRole } from "@/lib/auth/roles";
import {
  ADMIN_NAV,
  PRIMARY_NAV,
  isNavLinkActive,
  type NavLink,
} from "@/lib/nav/structure";

function NavLinkItem({
  link,
  active,
  onNavigate,
  mobile = false,
  muted = false,
}: {
  link: NavLink;
  active: boolean;
  onNavigate?: () => void;
  mobile?: boolean;
  muted?: boolean;
}) {
  const baseMobile = muted
    ? "block rounded-md px-3 py-2 text-amber-900/80 hover:bg-amber-50"
    : "block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-teal-700";
  const activeMobile = muted
    ? "block rounded-md bg-amber-100 px-3 py-2 font-bold text-amber-950"
    : "block rounded-md bg-slate-100 px-3 py-2 font-bold text-slate-900";
  const baseDesktop = muted
    ? "text-amber-800/80 hover:text-amber-950"
    : "text-slate-700 hover:text-teal-700";
  const activeDesktop = muted
    ? "cursor-default font-bold text-amber-950"
    : "cursor-default font-bold text-slate-900";

  if (active) {
    return (
      <span
        aria-current="page"
        className={mobile ? activeMobile : activeDesktop}
      >
        {link.label}
      </span>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      className={mobile ? baseMobile : baseDesktop}
    >
      {link.label}
    </Link>
  );
}

export function HeaderNav({ role }: { role: UserRole | null }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const primaryLinks = PRIMARY_NAV.filter(
    (link) => role && hasMinRole(role, link.minRole),
  );
  const adminLinks = ADMIN_NAV.filter(
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
      <nav className="hidden items-center gap-4 text-sm font-medium md:flex">
        {primaryLinks.map((link) => (
          <NavLinkItem
            key={link.href}
            link={link}
            active={isNavLinkActive(pathname, link)}
          />
        ))}
        {adminLinks.length > 0 ? (
          <>
            <span
              aria-hidden
              className="mx-1 h-4 w-px shrink-0 bg-slate-200"
            />
            {adminLinks.map((link) => (
              <NavLinkItem
                key={link.href}
                link={link}
                active={isNavLinkActive(pathname, link)}
                muted
              />
            ))}
          </>
        ) : null}
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
              {primaryLinks.map((link) => (
                <NavLinkItem
                  key={link.href}
                  link={link}
                  active={isNavLinkActive(pathname, link)}
                  onNavigate={closeMenu}
                  mobile
                />
              ))}
              {adminLinks.length > 0 ? (
                <>
                  <div className="my-2 border-t border-slate-100 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800/70">
                    Admin
                  </div>
                  {adminLinks.map((link) => (
                    <NavLinkItem
                      key={link.href}
                      link={link}
                      active={isNavLinkActive(pathname, link)}
                      onNavigate={closeMenu}
                      mobile
                      muted
                    />
                  ))}
                </>
              ) : null}
            </nav>
          </>
        ) : null}
      </div>
    </>
  );
}
