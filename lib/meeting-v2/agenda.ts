import { extractMeetingV2Agenda } from "@/lib/meeting-v2/service";

export async function extractAgendaItems(meetingId: string) {
  return extractMeetingV2Agenda(meetingId);
}
