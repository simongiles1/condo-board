export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { desc } from "drizzle-orm";
import Link from "next/link";

import { MeetingsGrid } from "@/components/MeetingsGrid";
import { MeetingsPageHeader } from "@/components/MeetingsPageHeader";
import { MeetingsV3Dashboard } from "@/components/MeetingsV3Dashboard";
import { MeetingsV4Dashboard } from "@/components/MeetingsV4Dashboard";
import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";
import { listMeetingsV4Sources } from "@/lib/meeting-v4/workspace";
import { listMeetingsV3Workspaces } from "@/lib/meeting-v3/package-status";
import { isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";
import { MeetingsV2Dashboard } from "@/app/(protected)/meetings/v2-components";
import { loadMeetingsV2DashboardCards } from "@/lib/meeting-v2/service";

function stripTabClass(active: boolean): string {
  return `flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-white text-slate-900 shadow-sm"
      : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
  }`;
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const db = getDb();
  const params = await searchParams;
  const version = params.v === "4" ? "v4" : params.v === "3" ? "v3" : params.v === "2" ? "v2" : "v1";

  const visibleMeetingRows = version === "v1"
    ? (await db.select().from(meetings).orderBy(desc(meetings.meetingDate))).filter(
        (meeting) => meeting.minutesContent.trim().length > 0,
      )
    : [];

  const meetingV2Cards = version === "v2"
    ? await loadMeetingsV2DashboardCards(
        (await db.select().from(meetingsV2).orderBy(desc(meetingsV2.meetingDate))).filter(
          (meeting) => !isMeetingsV3Workspace(meeting.settings),
        ),
      )
    : [];

  const meetingV3Cards = version === "v3" ? await listMeetingsV3Workspaces() : [];
  const meetingV4Cards = version === "v4" ? await listMeetingsV4Sources() : [];

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-0 py-4 md:px-6 md:py-6">
      <div className="flex flex-col space-y-4">
        <MeetingsPageHeader isV2={version === "v2"} isV3={version === "v3"} isV4={version === "v4"} />

        <div className="flex">
          <div className="flex space-x-1 rounded-lg bg-slate-100 p-1">
            <Link href="?v=1" className={stripTabClass(version === "v1")}>
              V1 Dashboard
            </Link>
            <Link href="?v=2" className={stripTabClass(version === "v2")}>
              V2 Pipeline
            </Link>
            <Link href="?v=3" className={stripTabClass(version === "v3")}>
              V3 Pipeline
            </Link>
            <Link href="?v=4" className={stripTabClass(version === "v4")}>
              V4 Pipeline
            </Link>
          </div>
        </div>
      </div>

      {version === "v1" ? (
        visibleMeetingRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
            Nothing saved yet — drop in a Teams VTT plus your reference PDF to
            generate the first workbook.
          </div>
        ) : (
          <MeetingsGrid meetings={visibleMeetingRows} />
        )
      ) : null}
      {version === "v2" ? <MeetingsV2Dashboard meetings={meetingV2Cards} /> : null}
      {version === "v3" ? <MeetingsV3Dashboard meetings={meetingV3Cards} /> : null}
      {version === "v4" ? <MeetingsV4Dashboard meetings={meetingV4Cards} /> : null}
    </div>
  );
}
