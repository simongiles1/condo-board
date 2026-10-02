import Link from "next/link";

/**
 * Lists V2 meetings that already have a reviewed transcript segmentation.
 */
export function MeetingsV4Dashboard({
  meetings,
}: {
  meetings: Array<{
    id: string;
    title: string;
    meetingDate: string;
    spanCount: number;
    draftedAt: string | null;
  }>;
}) {
  if (meetings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
        No reviewed segmentation yet. V4 reads the gold-standard spans stored on a V2 meeting.
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
            <th scope="col" className="px-3 py-2.5">Reviewed spans</th>
            <th scope="col" className="px-3 py-2.5">Draft</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {meetings.map((meeting) => (
            <tr key={meeting.id} className="hover:bg-slate-50/80">
              <td className="px-3 py-2.5 tabular-nums text-slate-700">
                <Link href={`/operations/meetings/v4/${meeting.id}`} className="block">
                  {meeting.meetingDate}
                </Link>
              </td>
              <td className="px-3 py-2.5 font-medium text-slate-900">
                <Link href={`/operations/meetings/v4/${meeting.id}`} className="block">
                  {meeting.title}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <Link href={`/operations/meetings/v4/${meeting.id}`} className="block">
                  {meeting.spanCount}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <Link href={`/operations/meetings/v4/${meeting.id}`} className="block">
                  {meeting.draftedAt ? "Stored" : "Not drafted"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
