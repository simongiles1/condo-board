export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { Suspense } from "react";

import { MeetingV3QuoteCompare } from "@/components/MeetingV3QuoteCompare";
import { loadMeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MeetingV3Page(props: PageProps) {
  const { id } = await props.params;
  const status = await loadMeetingsV3PackageStatus(id);
  if (!status) notFound();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-4 pt-2 md:px-6 md:pb-4 md:pt-3">
      <Suspense fallback={<p className="px-6 py-8 text-sm text-slate-600">Loading meeting…</p>}>
        <MeetingV3QuoteCompare initial={status} />
      </Suspense>
    </div>
  );
}
