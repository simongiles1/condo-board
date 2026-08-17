"use client";

import { SubNav } from "@/components/SubNav";
import { subNavForPath } from "@/lib/nav/structure";
import { usePathname } from "next/navigation";

export function SectionSubNav() {
  const pathname = usePathname();
  const tabs = subNavForPath(pathname);
  if (!tabs) return null;
  return <SubNav tabs={tabs} />;
}
