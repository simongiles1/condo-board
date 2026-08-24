import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";

export async function loadReferenceCorpus(meetingId: string) {
  return loadMeetingV2Detail(meetingId);
}
