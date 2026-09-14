import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";
import { getReferenceExpectation } from "./reference-expectations";
import { compareReferenceTopics } from "./reference-coverage";

export async function getReferenceAlignmentReport(meetingId: string) {
  const detail = await loadMeetingV2Detail(meetingId);

  return {
    meetingId,
    meetingStatus: detail.meeting.pipelineState,
    ...compareReferenceTopics(getReferenceExpectation(detail.meeting.meetingDate), detail.items),
    validationSummary: {
      warningCount: detail.items.reduce(
        (count, item) =>
          count +
          item.validation.filter((entry) => entry.severity === "warning").length,
        0,
      ),
      errorCount: detail.items.reduce(
        (count, item) =>
          count +
          item.validation.filter((entry) => entry.severity === "error").length,
        0,
      ),
    },
  };
}
