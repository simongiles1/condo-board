"use client";

import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";

import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";

type Props = {
  emails: BuildingEmailReference[];
  onOpenEmail: (emailId: string) => void;
};

export function AssetEmailInfoPopover({ emails, onOpenEmail }: Props) {
  if (!emails.length) {
    return <span className="text-slate-300">—</span>;
  }

  return <InsightSourceEmailsBadge emails={emails} onOpenEmail={onOpenEmail} />;
}
