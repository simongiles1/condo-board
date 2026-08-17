"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  isSubNavTabActive,
  type SubNavTab,
} from "@/lib/nav/structure";

export function SubNav({ tabs }: { tabs: SubNavTab[] }) {
  const pathname = usePathname();

  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Section"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      <div className="inline-flex min-w-min gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
        {tabs.map((tab) => {
          const active = isSubNavTabActive(pathname, tab);
          if (active) {
            return (
              <span
                key={tab.href}
                aria-current="page"
                className="whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200"
              >
                {tab.label}
              </span>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
