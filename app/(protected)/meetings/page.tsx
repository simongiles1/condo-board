export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { desc } from "drizzle-orm";

import { MeetingsGrid } from "@/components/MeetingsGrid";
import { MeetingsPageHeader } from "@/components/MeetingsPageHeader";
import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";

export default async function MeetingsPage() {
  const db = getDb();

  const meetingRows = await db
    .select()
    .from(meetings)
    .orderBy(desc(meetings.meetingDate));

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <MeetingsPageHeader />
      {meetingRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
          Nothing saved yet — drop in a Teams VTT plus your reference PDF to
          generate the first workbook.
        </div>
      ) : (
        <MeetingsGrid meetings={meetingRows} />
      )}
    </div>
  );
}
