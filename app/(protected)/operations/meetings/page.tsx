export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { desc } from "drizzle-orm";
import Link from "next/link";

import { MeetingsGrid } from "@/components/MeetingsGrid";
import { MeetingsPageHeader } from "@/components/MeetingsPageHeader";
import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";
import { MeetingsV2Dashboard } from "@/app/(protected)/meetings/v2-components";

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const db = getDb();
  
  // Await searchParams as required by Next.js 15
  const params = await searchParams;
  const isV2 = params.v === "2";

  const meetingRows = await db
    .select()
    .from(meetings)
    .orderBy(desc(meetings.meetingDate));

  const visibleMeetingRows = meetingRows.filter(
    (meeting) => meeting.minutesContent.trim().length > 0,
  );

  const meetingV2Rows = await db
    .select()
    .from(meetingsV2)
    .orderBy(desc(meetingsV2.meetingDate));

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
      <div className="flex flex-col space-y-4">
        <MeetingsPageHeader isV2={isV2} />
        
        <div className="flex">
          <div className="flex space-x-1 rounded-lg bg-slate-100 p-1">
            <Link
              href="?v=1"
              className={`flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                !isV2 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              V1 Dashboard
            </Link>
            <Link
              href="?v=2"
              className={`flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isV2 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              V2 Pipeline
            </Link>
          </div>
        </div>
      </div>

      {!isV2 ? (
        visibleMeetingRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
            Nothing saved yet — drop in a Teams VTT plus your reference PDF to
            generate the first workbook.
          </div>
        ) : (
          <MeetingsGrid meetings={visibleMeetingRows} />
        )
      ) : (
        <div className="px-4">
          <MeetingsV2Dashboard meetings={meetingV2Rows} />
        </div>
      )}
    </div>
  );
}
