export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { MeetingV2Detail } from "@/app/(protected)/meetings/v2-components";
import { ensureMeetingV2Seed } from "@/lib/meeting-v2/service";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MeetingV2DetailPage(props: PageProps) {
  const { id } = await props.params;

  try {
    await ensureMeetingV2Seed(id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-4 max-sm:py-3">
      <MeetingV2Detail meetingId={id} />
    </div>
  );
}
