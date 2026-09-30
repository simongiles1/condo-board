export const runtime = "nodejs";

import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { meetingsV3CreatedSettings } from "@/lib/meeting-v3/package-status";
import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";
import { revalidateMeetingsWorkspaceList } from "@/lib/meeting-v2/revalidate-workspace-list";
import { parseAgendaContentEndsAtPage } from "@/lib/meeting-v2/upcoming-meeting";

function assertFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const titleRaw = formData.get("title");
  const meetingDateRaw = formData.get("meetingDate");
  const transcriptFile = formData.get("transcript");
  const boardPackageFile = formData.get("boardPackage");
  const purpose = formData.get("purpose");
  const upcoming = purpose === "upcoming";
  const v3 = formData.get("pipeline") === "v3";

  if (
    typeof titleRaw !== "string" ||
    typeof meetingDateRaw !== "string" ||
    !titleRaw.trim()
  ) {
    return NextResponse.json(
      { error: "title and meetingDate are required" },
      { status: 400 },
    );
  }

  if (!upcoming && !assertFile(transcriptFile)) {
    return NextResponse.json(
      { error: "Microsoft Teams transcript (.vtt) is required." },
      { status: 400 },
    );
  }

  if (!assertFile(boardPackageFile)) {
    return NextResponse.json(
      { error: "Board meeting package PDF is required." },
      { status: 400 },
    );
  }

  if (!upcoming && assertFile(transcriptFile) && !transcriptFile.name.toLowerCase().endsWith(".vtt")) {
    return NextResponse.json(
      { error: "Transcript must be a .vtt file." },
      { status: 400 },
    );
  }

  if (!boardPackageFile.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Board package must be a .pdf file." },
      { status: 400 },
    );
  }

  const meetingId = randomUUID();
  const uploadRoot = path.join(process.cwd(), "uploads", meetingId);

  try {
    console.info("[meetings:v2:upload] received", {
      meetingId,
      title: titleRaw.trim(),
      meetingDate: meetingDateRaw,
      transcriptName: assertFile(transcriptFile) ? transcriptFile.name : null,
      upcoming,
      boardPackageName: boardPackageFile.name,
    });

    const vttBuffer =
      !upcoming && assertFile(transcriptFile)
        ? Buffer.from(await transcriptFile.arrayBuffer())
        : null;
    const boardPackageBuffer = Buffer.from(await boardPackageFile.arrayBuffer());
    const packagePageCount = await getPdfPageCount(
      boardPackageBuffer.buffer.slice(
        boardPackageBuffer.byteOffset,
        boardPackageBuffer.byteOffset + boardPackageBuffer.byteLength,
      ),
    );
    const needsAgendaSplit = upcoming || v3;
    const agendaContentEndsAtPage = needsAgendaSplit
      ? parseAgendaContentEndsAtPage(formData.get("agendaContentEndsAtPage"), packagePageCount)
      : null;
    if (needsAgendaSplit && agendaContentEndsAtPage == null) {
      return NextResponse.json(
        { error: "Choose the last agenda page. At least one later page must be an attachment." },
        { status: 400 },
      );
    }

    await mkdir(uploadRoot, { recursive: true });

    const vttAbsolute = path.join(uploadRoot, "transcript.vtt");
    const boardPackageAbsolute = path.join(uploadRoot, "board-package.pdf");

    if (vttBuffer) await writeFile(vttAbsolute, vttBuffer);
    await writeFile(boardPackageAbsolute, boardPackageBuffer);

    const db = getDb();
    const createdAt = new Date().toISOString();

    await db.insert(meetings).values({
      id: meetingId,
      meetingDate: meetingDateRaw,
      title: titleRaw.trim(),
      status: "draft",
      minutesContent: "",
      minutesJson: null,
      aiUsageJson: null,
      todosContent: "",
      vttFilePath: vttBuffer
        ? path.relative(process.cwd(), vttAbsolute).replace(/\\/g, "/")
        : "",
      pdfFilePath: "",
      boardPackageFilePath: path
        .relative(process.cwd(), boardPackageAbsolute)
        .replace(/\\/g, "/"),
      createdAt,
    });

    await db.insert(meetingsV2).values({
      id: meetingId,
      sourceKey: meetingId,
      title: titleRaw.trim(),
      meetingDate: meetingDateRaw,
      pipelineState: "created",
      currentStep: v3
        ? "Ready to extract the board package"
        : upcoming
          ? "Preparing the board package"
          : "Ready to start",
      progressPercent: 0,
      lastError: null,
      settings: v3
        ? meetingsV3CreatedSettings(
            createdAt,
            agendaContentEndsAtPage != null
              ? { agendaContentEndsAtPage: agendaContentEndsAtPage }
              : null,
          )
        : upcoming
          ? { upcomingMeeting: { agendaContentEndsAtPage: agendaContentEndsAtPage! } }
          : {},
      createdAt,
      updatedAt: createdAt,
    });

    if (upcoming && !v3) {
      try {
        await inngest.send({
          name: "meeting-v2/pipeline.start",
          data: { meetingId },
        });
      } catch (error) {
        console.error("[meetings:v2:upload] pipeline start failed", error);
      }
    }

    console.info("[meetings:v2:upload] rows created", { meetingId });

    revalidateMeetingsWorkspaceList();

    return NextResponse.json({ id: meetingId });
  } catch (error) {
    await rm(uploadRoot, { recursive: true, force: true });
    console.error("[meetings:v2:upload]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Could not create V2 meeting workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
