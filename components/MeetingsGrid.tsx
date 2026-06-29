"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { GoldStandardCompareDialog } from "@/components/GoldStandardCompareDialog";
import { GoldStandardValidationSidePanel } from "@/components/GoldStandardValidationSidePanel";
import { MeetingCard } from "@/components/MeetingCard";
import type { Meeting } from "@/lib/db/types";
import {
  parseStoredGoldStandardValidation,
  type GoldStandardValidationResult,
} from "@/lib/minutes/gold-standard-schema";

type Props = {
  meetings: Meeting[];
};

export function MeetingsGrid({ meetings }: Props) {
  const router = useRouter();
  const [panelMeetingId, setPanelMeetingId] = useState<string | null>(null);
  const [compareDialogMeetingId, setCompareDialogMeetingId] = useState<
    string | null
  >(null);
  const [liveValidationByMeetingId, setLiveValidationByMeetingId] = useState<
    Record<string, GoldStandardValidationResult>
  >({});
  const [liveAiUsageByMeetingId, setLiveAiUsageByMeetingId] = useState<
    Record<string, string>
  >({});

  const panelMeeting = useMemo(() => {
    const meeting = meetings.find((row) => row.id === panelMeetingId) ?? null;
    if (!meeting) return null;
    const aiUsageJson =
      liveAiUsageByMeetingId[meeting.id] ?? meeting.aiUsageJson;
    return { ...meeting, aiUsageJson };
  }, [meetings, panelMeetingId, liveAiUsageByMeetingId]);

  const compareDialogMeeting = useMemo(
    () =>
      meetings.find((meeting) => meeting.id === compareDialogMeetingId) ?? null,
    [meetings, compareDialogMeetingId],
  );

  const panelValidation = useMemo(() => {
    if (!panelMeetingId) return null;
    if (liveValidationByMeetingId[panelMeetingId]) {
      return liveValidationByMeetingId[panelMeetingId];
    }
    const meeting = meetings.find((row) => row.id === panelMeetingId);
    return parseStoredGoldStandardValidation(
      meeting?.goldStandardValidationJson,
    );
  }, [panelMeetingId, liveValidationByMeetingId, meetings]);

  const getValidationScore = useCallback(
    (meeting: Meeting): number | null => {
      const live = liveValidationByMeetingId[meeting.id];
      if (live) return live.validationScore;
      const stored = parseStoredGoldStandardValidation(
        meeting.goldStandardValidationJson,
      );
      return stored?.validationScore ?? null;
    },
    [liveValidationByMeetingId],
  );

  function handleValidationBadgeClick(meeting: Meeting) {
    const score = getValidationScore(meeting);
    if (score !== null) {
      setPanelMeetingId(meeting.id);
      return;
    }
    setCompareDialogMeetingId(meeting.id);
  }

  function handleCompareSuccess(
    validation: GoldStandardValidationResult,
    aiUsageJson: string,
  ) {
    if (!compareDialogMeetingId) return;

    setLiveValidationByMeetingId((current) => ({
      ...current,
      [compareDialogMeetingId]: validation,
    }));
    setLiveAiUsageByMeetingId((current) => ({
      ...current,
      [compareDialogMeetingId]: aiUsageJson,
    }));
    setCompareDialogMeetingId(null);
    setPanelMeetingId(compareDialogMeetingId);
    router.refresh();
  }

  function handleReCompare() {
    if (!panelMeetingId) return;
    setCompareDialogMeetingId(panelMeetingId);
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {meetings.map((meeting) => (
          <MeetingCard
            key={meeting.id}
            meeting={meeting}
            validationScore={getValidationScore(meeting)}
            onValidationBadgeClick={() => handleValidationBadgeClick(meeting)}
          />
        ))}
      </div>

      <GoldStandardCompareDialog
        open={compareDialogMeetingId !== null}
        meetingId={compareDialogMeetingId}
        meetingTitle={compareDialogMeeting?.title ?? null}
        onClose={() => setCompareDialogMeetingId(null)}
        onSuccess={handleCompareSuccess}
      />

      <GoldStandardValidationSidePanel
        meeting={panelMeeting}
        validation={panelValidation}
        onClose={() => setPanelMeetingId(null)}
        onReCompare={handleReCompare}
      />
    </>
  );
}
