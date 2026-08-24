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
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <MeetingV2Detail meetingId={id} />
    </div>
  );
}
