export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { LiveMeetingRoom } from "@/components/LiveMeetingRoom";
import { ensureMeetingV2Seed } from "@/lib/meeting-v2/service";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LiveMeetingRoomPage(props: PageProps) {
  const { id } = await props.params;

  try {
    await ensureMeetingV2Seed(id);
  } catch {
    notFound();
  }

  return <LiveMeetingRoom meetingId={id} />;
}
