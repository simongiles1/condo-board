import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";

export async function loadReviewWorkspace(meetingId: string) {
  return loadMeetingV2Detail(meetingId);
}
