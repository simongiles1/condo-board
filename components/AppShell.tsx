"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AuthNavActions } from "@/components/AuthNavActions";
import { EntityProfileProvider } from "@/components/EntityProfileProvider";
import { CloseIcon, MenuIcon } from "@/components/nav-icons";
import { SidebarNav } from "@/components/SidebarNav";
import type { UserRole } from "@/lib/auth/roles";
import { NAV_COLLAPSED_COOKIE } from "@/lib/nav/structure";
import type { MouseEvent, ReactNode, RefObject } from "react";

type ShellUser = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type NavLocation = {
  pathname: string;
  search: string;
};

export function AppShell({
  role,
  user,
  collapsed: collapsedInitial,
  children,
}: {
  role: UserRole | null;
  user: ShellUser | null;
  collapsed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(collapsedInitial);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navPending, setNavPending] = useState(false);
  const navStartRef = useRef<NavLocation | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COLLAPSED_COOKIE}=${next ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // RSC destinations can sit on the old page until the server responds.
  // Show a blur+spinner on the content pane as soon as a sidebar link is clicked.
  function handleNavClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const fromTarget =
      event.target instanceof Element ? event.target.closest("a") : null;
    const anchor =
      event.currentTarget instanceof HTMLAnchorElement
        ? event.currentTarget
        : fromTarget;
    if (!anchor) return;
    const target = navLocationFromAnchor(anchor);
    if (!target) return;
    const start = {
      pathname,
      search: currentSearchParams(),
    };
    if (sameNavLocation(start, target)) return;
    navStartRef.current = start;
    setNavPending(true);
  }

  const clearNavPending = useCallback(() => {
    navStartRef.current = null;
    setNavPending(false);
  }, []);

  const userProps = {
    email: user?.email ?? null,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    role,
  };

  return (
    <EntityProfileProvider>
    <div className="flex min-h-0 flex-1">
      <aside
        className={`relative z-30 hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
        onClickCapture={handleNavClick}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
            <SidebarNav
              role={role}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
            />
          </Suspense>
        </div>
        <div className={`border-t border-slate-100 p-2 ${collapsed ? "flex justify-center" : ""}`}>
          <AuthNavActions {...userProps} variant="sidebar" collapsed={collapsed} />
        </div>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[filter] duration-150 ${
            navPending ? "pointer-events-none blur-[3px]" : ""
          }`}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav-drawer"
                aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
                onClick={() => setMobileOpen((open) => !open)}
                className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                {mobileOpen ? <CloseIcon /> : <MenuIcon />}
              </button>
              <Link
                href="/"
                onClick={handleNavClick}
                className="truncate text-sm font-semibold text-teal-800"
              >
                Condo Board
              </Link>
            </div>
            <AuthNavActions {...userProps} />
          </header>

          <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-4 md:py-6">
            {children}
          </main>
        </div>
        {navPending ? <NavPendingOverlay /> : null}
        <Suspense fallback={null}>
          <NavPendingClearer
            pending={navPending}
            startRef={navStartRef}
            onReached={clearNavPending}
          />
        </Suspense>
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-40 bg-black/20 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            id="mobile-nav-drawer"
            className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-200 bg-white shadow-2xl md:hidden"
            onClickCapture={handleNavClick}
          >
            <Suspense fallback={<SidebarFallback collapsed={false} />}>
              <SidebarNav
                role={role}
                collapsed={false}
                showCollapseToggle={false}
                onToggleCollapsed={() => setMobileOpen(false)}
                onClose={() => setMobileOpen(false)}
                onNavigate={() => setMobileOpen(false)}
              />
            </Suspense>
          </aside>
        </>
      ) : null}
    </div>
    </EntityProfileProvider>
  );
}

function SidebarFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex-1 ${collapsed ? "px-2 py-3" : "px-3 py-3"}`}>
      <div className="h-9 rounded-lg bg-slate-100" />
    </div>
  );
}

function NavPendingOverlay() {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-white/35"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <span className="sr-only">Loading page</span>
      <span className="nav-pending-spinner" aria-hidden />
    </div>
  );
}

function NavPendingClearer({
  pending,
  startRef,
  onReached,
}: {
  pending: boolean;
  startRef: RefObject<NavLocation | null>;
  onReached: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pending) return;
    const start = startRef.current;
    if (!start) return;
    const current = { pathname, search: searchParams.toString() };
    // Any URL change means the destination (or a redirect) has taken over.
    if (!sameNavLocation(current, start)) onReached();
  }, [onReached, pathname, pending, searchParams, startRef]);

  return null;
}

function currentSearchParams(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).toString();
}

function navLocationFromAnchor(anchor: HTMLAnchorElement): NavLocation | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return { pathname: url.pathname, search: url.searchParams.toString() };
}

function sameNavLocation(a: NavLocation, b: NavLocation): boolean {
  return a.pathname === b.pathname && a.search === b.search;
}
