"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BuildoutProgressButton } from "@/components/BuildoutProgressDialog";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  NavIcon,
} from "@/components/nav-icons";
import { hasMinRole, type UserRole } from "@/lib/auth/roles";
import {
  isSidebarSectionActive,
  isSubNavTabActive,
  matchSection,
  SIDEBAR_SECTIONS,
  type SidebarSection,
  type SubNavTab,
} from "@/lib/nav/structure";

const HOVER_CLOSE_MS = 140;

export function SidebarNav({
  role,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  showCollapseToggle = true,
  onClose,
}: {
  role: UserRole | null;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  showCollapseToggle?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSectionId = matchSection(pathname);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(activeSectionId ? [activeSectionId] : []),
  );
  const [drawerId, setDrawerId] = useState<NavSectionIdOrNull>(null);
  const closeTimer = useRef<number | null>(null);

  const sections = SIDEBAR_SECTIONS.filter(
    (section) => role && hasMinRole(role, section.minRole),
  );
  const primary = sections.filter((section) => section.tone !== "admin");
  const admin = sections.filter((section) => section.tone === "admin");

  useEffect(() => {
    if (!activeSectionId) return;
    setOpenIds((prev) => {
      if (prev.has(activeSectionId)) return prev;
      const next = new Set(prev);
      next.add(activeSectionId);
      return next;
    });
  }, [activeSectionId]);

  useEffect(() => {
    setDrawerId(null);
  }, [collapsed, pathname]);

  function clearCloseTimer() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openDrawer(id: SidebarSection["id"]) {
    clearCloseTimer();
    setDrawerId(id);
  }

  function scheduleCloseDrawer() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setDrawerId(null);
    }, HOVER_CLOSE_MS);
  }

  function toggleSection(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const drawerSection = collapsed
    ? sections.find((section) => section.id === drawerId)
    : undefined;
  const showDrawer = Boolean(
    collapsed && drawerSection && (drawerSection.children?.length ?? 0) > 0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={
          collapsed
            ? "flex flex-col items-center gap-2 px-2 py-3"
            : "flex h-14 items-center justify-between gap-2 px-3"
        }
      >
        {collapsed ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">
            CB
          </span>
        ) : (
          <Link
            href="/"
            onClick={onNavigate}
            className="min-w-0 truncate text-sm font-semibold text-teal-800"
          >
            Condo Board
          </Link>
        )}
        {showCollapseToggle ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        ) : onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <ChevronLeftIcon />
          </button>
        ) : null}
      </div>

      <nav
        aria-label="Main"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
      >
        <SectionList
          sections={primary}
          collapsed={collapsed}
          pathname={pathname}
          query={searchParams}
          openIds={openIds}
          drawerId={drawerId}
          onToggleSection={toggleSection}
          onNavigate={onNavigate}
          onDrawerEnter={openDrawer}
          onDrawerLeave={scheduleCloseDrawer}
        />
        {admin.length > 0 ? (
          <>
            <div className="min-h-2 flex-1" />
            <div
              className={
                collapsed
                  ? "mx-auto my-3 h-px w-8 bg-amber-200"
                  : "mx-2 my-3 border-t border-amber-200/80 pt-3 text-[10px] font-semibold uppercase tracking-wide text-amber-800/70"
              }
            >
              {collapsed ? null : "Admin"}
            </div>
            <div className={collapsed ? "mb-0.5 flex justify-center" : "mb-0.5"}>
              <BuildoutProgressButton collapsed={collapsed} />
            </div>
            <SectionList
              sections={admin}
              collapsed={collapsed}
              pathname={pathname}
              query={searchParams}
              openIds={openIds}
              drawerId={drawerId}
              onToggleSection={toggleSection}
              onNavigate={onNavigate}
              onDrawerEnter={openDrawer}
              onDrawerLeave={scheduleCloseDrawer}
              admin
            />
          </>
        ) : null}
      </nav>

      {showDrawer && drawerSection ? (
        <HoverDrawer
          section={drawerSection}
          pathname={pathname}
          query={searchParams}
          onEnter={() => openDrawer(drawerSection.id)}
          onLeave={scheduleCloseDrawer}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

type NavSectionIdOrNull = SidebarSection["id"] | null;

function SectionList({
  sections,
  collapsed,
  pathname,
  query,
  openIds,
  drawerId,
  onToggleSection,
  onNavigate,
  onDrawerEnter,
  onDrawerLeave,
  admin = false,
}: {
  sections: SidebarSection[];
  collapsed: boolean;
  pathname: string;
  query: { get(name: string): string | null };
  openIds: Set<string>;
  drawerId: NavSectionIdOrNull;
  onToggleSection: (id: string) => void;
  onNavigate?: () => void;
  onDrawerEnter: (id: SidebarSection["id"]) => void;
  onDrawerLeave: () => void;
  admin?: boolean;
}) {
  return (
    <ul className={`flex flex-col gap-0.5 ${collapsed ? "items-center" : ""}`}>
      {sections.map((section) => {
        const active = isSidebarSectionActive(pathname, section);
        const hasChildren = (section.children?.length ?? 0) > 0;
        const expanded = openIds.has(section.id);

        if (collapsed) {
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                title={section.label}
                aria-label={section.label}
                aria-haspopup={hasChildren ? "menu" : undefined}
                aria-expanded={hasChildren ? drawerId === section.id : undefined}
                onClick={onNavigate}
                onMouseEnter={() => {
                  if (hasChildren) onDrawerEnter(section.id);
                }}
                onMouseLeave={() => {
                  if (hasChildren) onDrawerLeave();
                }}
                onFocus={() => {
                  if (hasChildren) onDrawerEnter(section.id);
                }}
                onBlur={(event) => {
                  if (!hasChildren) return;
                  const next = event.relatedTarget as Node | null;
                  if (next && event.currentTarget.contains(next)) return;
                  onDrawerLeave();
                }}
                className={railButtonClass(active, admin)}
              >
                <NavIcon name={section.icon} className="h-5 w-5" />
                {hasChildren ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-teal-500" />
                ) : null}
              </Link>
            </li>
          );
        }

        if (!hasChildren) {
          return (
            <li key={section.id}>
              {active ? (
                <span
                  aria-current="page"
                  className={treeParentClass(true, admin)}
                >
                  <NavIcon name={section.icon} className="h-5 w-5 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </span>
              ) : (
                <Link
                  href={section.href}
                  onClick={onNavigate}
                  className={treeParentClass(false, admin)}
                >
                  <NavIcon name={section.icon} className="h-5 w-5 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </Link>
              )}
            </li>
          );
        }

        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onToggleSection(section.id)}
              aria-expanded={expanded}
              className={treeParentClass(active, admin)}
            >
              <NavIcon name={section.icon} className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {section.label}
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 transition ${expanded ? "rotate-0" : "-rotate-90"}`}
              />
            </button>
            {expanded && section.children ? (
              <TreeLinks
                items={section.children}
                pathname={pathname}
                query={query}
                onNavigate={onNavigate}
                depth={1}
                admin={admin}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TreeLinks({
  items,
  pathname,
  query,
  onNavigate,
  depth,
  admin,
}: {
  items: SubNavTab[];
  pathname: string;
  query: { get(name: string): string | null };
  onNavigate?: () => void;
  depth: number;
  admin: boolean;
}) {
  return (
    <ul className={depth === 1 ? "mt-0.5 ml-4 border-l border-slate-200" : "ml-2"}>
      {items.map((item) => {
        const active = isSubNavTabActive(pathname, item, query);
        const hasKids = (item.children?.length ?? 0) > 0;
        return (
          <li key={item.href}>
            {active && !hasKids ? (
              <span
                aria-current="page"
                className={treeChildClass(true, depth, admin)}
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                onClick={onNavigate}
                className={treeChildClass(active, depth, admin)}
              >
                {item.label}
              </Link>
            )}
            {item.children ? (
              <TreeLinks
                items={item.children}
                pathname={pathname}
                query={query}
                onNavigate={onNavigate}
                depth={depth + 1}
                admin={admin}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HoverDrawer({
  section,
  pathname,
  query,
  onEnter,
  onLeave,
  onNavigate,
}: {
  section: SidebarSection;
  pathname: string;
  query: { get(name: string): string | null };
  onEnter: () => void;
  onLeave: () => void;
  onNavigate?: () => void;
}) {
  const admin = section.tone === "admin";
  return (
    <div
      role="menu"
      aria-label={section.label}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      className="fixed top-0 bottom-0 left-16 z-50 flex w-60 flex-col border-r border-slate-200 bg-white shadow-2xl"
    >
      <div className="border-b border-slate-100 px-4 py-4">
        <p
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            admin ? "text-amber-700/80" : "text-slate-400"
          }`}
        >
          {section.category}
        </p>
        <p
          className={`mt-1 text-lg font-semibold ${
            admin ? "text-amber-950" : "text-slate-900"
          }`}
        >
          {section.label}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {section.children ? (
          <DrawerLinks
            items={section.children}
            pathname={pathname}
            query={query}
            onNavigate={onNavigate}
            depth={1}
            admin={admin}
          />
        ) : null}
      </div>
    </div>
  );
}

function DrawerLinks({
  items,
  pathname,
  query,
  onNavigate,
  depth,
  admin,
}: {
  items: SubNavTab[];
  pathname: string;
  query: { get(name: string): string | null };
  onNavigate?: () => void;
  depth: number;
  admin: boolean;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isSubNavTabActive(pathname, item, query);
        const nested = depth > 1;
        return (
          <li key={item.href}>
            {active && !item.children ? (
              <span
                aria-current="page"
                className={drawerLinkClass(true, nested, admin)}
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                role="menuitem"
                onClick={onNavigate}
                className={drawerLinkClass(active, nested, admin)}
              >
                {item.label}
              </Link>
            )}
            {item.children ? (
              <div className="mb-1 ml-3 mt-0.5">
                <DrawerLinks
                  items={item.children}
                  pathname={pathname}
                  query={query}
                  onNavigate={onNavigate}
                  depth={depth + 1}
                  admin={admin}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function railButtonClass(active: boolean, admin: boolean): string {
  const base =
    "relative flex h-10 w-10 items-center justify-center rounded-lg transition";
  if (active) {
    return admin
      ? `${base} bg-amber-100 text-amber-950`
      : `${base} bg-teal-50 text-teal-800`;
  }
  return admin
    ? `${base} text-amber-800/80 hover:bg-amber-50 hover:text-amber-950`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
}

function treeParentClass(active: boolean, admin: boolean): string {
  const base =
    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium";
  if (active) {
    return admin
      ? `${base} bg-amber-100 text-amber-950`
      : `${base} bg-teal-50 text-teal-800`;
  }
  return admin
    ? `${base} text-amber-900/80 hover:bg-amber-50 hover:text-amber-950`
    : `${base} text-slate-700 hover:bg-slate-100 hover:text-slate-900`;
}

function treeChildClass(
  active: boolean,
  depth: number,
  admin: boolean,
): string {
  const nested = depth > 1;
  const base = nested
    ? "block rounded-md py-1 pl-3 pr-2 text-xs"
    : "block rounded-r-md border-l-2 py-1.5 pl-3 pr-2 text-sm";
  if (active) {
    return admin
      ? `${base} border-amber-600 bg-amber-50 font-semibold text-amber-950`
      : `${base} border-teal-600 bg-teal-50 font-semibold text-teal-900`;
  }
  return admin
    ? `${base} border-transparent text-amber-900/70 hover:bg-amber-50 hover:text-amber-950`
    : `${base} border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900`;
}

function drawerLinkClass(
  active: boolean,
  nested: boolean,
  admin: boolean,
): string {
  const base = nested
    ? "block rounded-md px-2 py-1 text-xs"
    : "block rounded-lg px-3 py-2 text-sm font-medium";
  if (active) {
    return admin
      ? `${base} bg-amber-100 font-semibold text-amber-950`
      : `${base} bg-teal-50 font-semibold text-teal-900`;
  }
  return admin
    ? `${base} text-amber-900/80 hover:bg-amber-50 hover:text-amber-950`
    : `${base} text-slate-700 hover:bg-slate-50 hover:text-slate-900`;
}
