export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MeetingV4Workspace } from "@/components/MeetingV4Workspace";
import { loadMeetingsV4Workspace, MeetingsV4Error } from "@/lib/meeting-v4/workspace";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MeetingV4Page(props: PageProps) {
  const { id } = await props.params;
  try {
    const workspace = await loadMeetingsV4Workspace(id);
    if (!workspace) notFound();
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-4 pt-2 md:px-6 md:pb-4 md:pt-3">
        <Suspense fallback={<p className="px-6 py-8 text-sm text-slate-600">Loading meeting…</p>}>
          <MeetingV4Workspace initial={workspace} />
        </Suspense>
      </div>
    );
  } catch (error) {
    if (error instanceof MeetingsV4Error) notFound();
    throw error;
  }
}
