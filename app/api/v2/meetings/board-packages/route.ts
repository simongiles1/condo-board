export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { loadCategorizedFiles } from "@/lib/email/load-categorized-files";
import { listBoardPackageSeriesFiles } from "@/lib/documents/series";
import {
  matchBoardPackageForMeetingDate,
  parsedBoardPackageIsoDate,
  type BoardPackageCandidate,
} from "@/lib/meeting-v2/match-board-package";

export async function GET(req: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const meetingDate = new URL(req.url).searchParams.get("meetingDate");
  if (!meetingDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return NextResponse.json(
      { error: "meetingDate (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  try {
    const discovered = await listBoardPackageSeriesFiles();
    const packages: BoardPackageCandidate[] =
      discovered.length > 0
        ? discovered.map((file) => ({
            id: file.id,
            filename: file.filename,
            receivedAt: file.receivedAt,
            sizeBytes: file.sizeBytes,
            parsedDate: file.parsedDate ?? parsedBoardPackageIsoDate(file.filename),
          }))
        : (await loadCategorizedFiles())["board-package"].map((file) => ({
            id: file.id,
            filename: file.filename,
            receivedAt: file.receivedAt,
            sizeBytes: file.sizeBytes,
            parsedDate: parsedBoardPackageIsoDate(file.filename),
          }));

    return NextResponse.json(
      matchBoardPackageForMeetingDate(meetingDate, packages),
    );
  } catch (error) {
    console.error("[meetings:v2:board-packages]", error);
    return NextResponse.json(
      { error: "Could not load board packages on file." },
      { status: 500 },
    );
  }
}
