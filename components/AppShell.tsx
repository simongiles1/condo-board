"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthNavActions } from "@/components/AuthNavActions";
import { CloseIcon, MenuIcon } from "@/components/nav-icons";
import { SidebarNav } from "@/components/SidebarNav";
import type { UserRole } from "@/lib/auth/roles";
import { NAV_COLLAPSED_COOKIE } from "@/lib/nav/structure";
import type { ReactNode } from "react";

type ShellUser = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
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

  const userProps = {
    email: user?.email ?? null,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    role,
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={`relative z-30 hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
            <Link href="/" className="truncate text-sm font-semibold text-teal-800">
              Condo Board
            </Link>
          </div>
          <AuthNavActions {...userProps} />
        </header>

        <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-4 md:py-6">
          {children}
        </main>
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
  );
}

function SidebarFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex-1 ${collapsed ? "px-2 py-3" : "px-3 py-3"}`}>
      <div className="h-9 rounded-lg bg-slate-100" />
    </div>
  );
}
