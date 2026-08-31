"use client";

import { inferRolePhrase } from "@/lib/contacts/mention-shared";
import {
  formatResolutionReasonCode,
  resolutionReasonLabel,
} from "@/lib/entities/resolution-reason";

export function RolePhraseBadge({
  rolePhrase,
  jobTitle,
}: {
  rolePhrase?: string | null;
  jobTitle?: string | null;
}) {
  const phrase =
    rolePhrase?.trim() || inferRolePhrase(jobTitle) || null;
  if (!phrase) return null;
  return (
    <span
      title={jobTitle?.trim() && jobTitle.trim() !== phrase ? jobTitle : phrase}
      className="inline-flex rounded bg-sky-50 px-1.5 py-px text-[11px] font-medium text-sky-900 ring-1 ring-sky-200/90"
    >
      {phrase}
    </span>
  );
}

export function ResolutionReasonBadge({
  reason,
}: {
  reason: string | null | undefined;
}) {
  const code = formatResolutionReasonCode(reason);
  if (!code) return null;
  const label = resolutionReasonLabel(code) ?? code;
  return (
    <span
      title={label}
      className="inline-flex max-w-full truncate rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-medium text-slate-800 ring-1 ring-slate-200/90"
    >
      {code}
    </span>
  );
}

export function MintedBadge({ minted }: { minted: boolean }) {
  return minted ? (
    <span className="inline-flex rounded bg-emerald-50 px-1.5 py-px text-[11px] font-medium text-emerald-900 ring-1 ring-emerald-200/90">
      Minted
    </span>
  ) : (
    <span className="inline-flex rounded bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-950 ring-1 ring-amber-200/90">
      Unminted
    </span>
  );
}
