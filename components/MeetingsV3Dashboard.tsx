import Link from "next/link";

import type { MeetingsV3WorkspaceCard } from "@/lib/meeting-v3/package-status";
import type { MeetingsV3PackageStage } from "@/lib/meeting-v3/workspace";

const STAGE_LABEL: Record<MeetingsV3PackageStage, string> = {
  created: "Not extracted",
  extracting: "Extracting package",
  correcting: "Correcting every page",
  ready: "Pages corrected",
  failed: "Extraction failed",
};

/**
 * Lists V3 meetings and opens the package comparison.
 */
export function MeetingsV3Dashboard({ meetings }: { meetings: MeetingsV3WorkspaceCard[] }) {
  if (meetings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
        No V3 meetings yet. Create one with a board package, then extract it to compare the PDF, Docling text, and the corrected page.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2.5">Meeting date</th>
            <th scope="col" className="px-3 py-2.5">Title</th>
            <th scope="col" className="px-3 py-2.5">Package</th>
            <th scope="col" className="px-3 py-2.5">Corrected</th>
            <th scope="col" className="px-3 py-2.5">Agenda</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {meetings.map((meeting) => (
            <tr key={meeting.id} className="hover:bg-slate-50/80">
              <td className="px-3 py-2.5 tabular-nums text-slate-700">
                <Link href={`/operations/meetings/v3/${meeting.id}`} className="block">
                  {meeting.meetingDate}
                </Link>
              </td>
              <td className="px-3 py-2.5 font-medium text-slate-900">
                <Link href={`/operations/meetings/v3/${meeting.id}`} className="block">
                  {meeting.title}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <Link href={`/operations/meetings/v3/${meeting.id}`} className="block">
                  <span className="font-medium">{STAGE_LABEL[meeting.stage]}</span>
                  {meeting.pageCount > 0 ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {meeting.pageCount} extracted {meeting.pageCount === 1 ? "page" : "pages"}
                    </span>
                  ) : null}
                  {meeting.stage === "failed" && meeting.error ? (
                    <span className="mt-0.5 block text-xs text-red-700">{meeting.error}</span>
                  ) : null}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <Link href={`/operations/meetings/v3/${meeting.id}`} className="block">
                  {meeting.correctedPageCount > 0
                    ? `${meeting.correctedPageCount} of ${meeting.pageCount} ${meeting.pageCount === 1 ? "page" : "pages"}`
                    : "None yet"}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <Link href={`/operations/meetings/v3/${meeting.id}`} className="block">
                  {meeting.agendaItemCount > 0
                    ? `${meeting.agendaItemCount} ${meeting.agendaItemCount === 1 ? "item" : "items"}`
                    : "Not built"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
