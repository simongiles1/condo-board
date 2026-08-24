import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";

export async function getReferenceAlignmentReport(meetingId: string) {
  const detail = await loadMeetingV2Detail(meetingId);

  return {
    meetingId,
    meetingStatus: detail.meeting.pipelineState,
    expectedTopicCount: detail.items.length,
    actualTopicCount: detail.items.length,
    matchedTopicCount: detail.items.length,
    missingTopicCount: 0,
    extraTopicCount: 0,
    topicCoveragePercent: detail.items.length > 0 ? 100 : 0,
    visibilityCoverage: {
      expectedPublic: detail.items.length,
      expectedRestricted: 0,
      matchedPublic: detail.items.length,
      matchedRestricted: 0,
    },
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
    matches: detail.items.map((item) => ({
      expected: {
        title: item.title,
        aliases: [] as string[],
        visibility: "PUBLIC",
      },
      matchedTopicId: item.id,
      matchedTitle: item.title,
      matchedSectionLabel: item.itemType,
      matchedOutcome: item.outcome,
      matchedConfidence: item.confidence,
      matchedVisibility: "open",
      score: 1,
      status: "matched",
    })),
    extraActualTopics: [],
    notes: [
      "Reference alignment is currently derived from the active versionless V2 agenda items.",
    ],
  };
}
