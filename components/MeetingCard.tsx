import Link from "next/link";

import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";
import { GoldStandardValidationBadge } from "@/components/GoldStandardValidationBadge";
import type { Meeting } from "@/lib/db/types";
import { formatMeetingDate } from "@/lib/format-meeting-date";

type Props = {
  meeting: Meeting;
  validationScore?: number | null;
  onValidationBadgeClick?: () => void;
};

export function MeetingCard({
  meeting,
  validationScore = null,
  onValidationBadgeClick,
}: Props) {
  const isFinal = meeting.status === "finalized";
  const badgeCls = isFinal
    ? "bg-emerald-100 text-emerald-900 ring-emerald-200"
    : "bg-amber-100 text-amber-900 ring-amber-200";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-transparent transition hover:border-teal-200 hover:ring-teal-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {meeting.title}
          </h2>
          <p className="text-sm text-slate-500">
            Meeting date:&nbsp;
            <time dateTime={meeting.meetingDate}>
              {formatMeetingDate(meeting.meetingDate)}
            </time>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Saved {new Date(meeting.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onValidationBadgeClick ? (
              <GoldStandardValidationBadge
                validationScore={validationScore}
                onClick={onValidationBadgeClick}
              />
            ) : null}
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${badgeCls}`}
            >
              {isFinal ? "Finalized" : "Draft"}
            </span>
            <DeleteMeetingButton
              meetingId={meeting.id}
              meetingTitle={meeting.title}
            />
          </div>
          <Link
            href={`/operations/meetings/${meeting.id}`}
            className="text-sm font-medium text-teal-700 hover:text-teal-900"
          >
            Open workspace →
          </Link>
        </div>
      </div>
    </article>
  );
}
