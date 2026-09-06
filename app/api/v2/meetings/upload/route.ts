export const runtime = "nodejs";

import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { after, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";
import { seedMeetingV2TranscriptSegments } from "@/lib/meeting-v2/transcript";

function assertFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const titleRaw = formData.get("title");
  const meetingDateRaw = formData.get("meetingDate");
  const transcriptFile = formData.get("transcript");
  const boardPackageFile = formData.get("boardPackage");

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

  if (!assertFile(transcriptFile)) {
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

  if (!transcriptFile.name.toLowerCase().endsWith(".vtt")) {
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
      transcriptName: transcriptFile.name,
      boardPackageName: boardPackageFile.name,
    });

    const vttBuffer = Buffer.from(await transcriptFile.arrayBuffer());
    const boardPackageBuffer = Buffer.from(await boardPackageFile.arrayBuffer());

    await mkdir(uploadRoot, { recursive: true });

    const vttAbsolute = path.join(uploadRoot, "transcript.vtt");
    const boardPackageAbsolute = path.join(uploadRoot, "board-package.pdf");

    await writeFile(vttAbsolute, vttBuffer);
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
      vttFilePath: path.relative(process.cwd(), vttAbsolute).replace(/\\/g, "/"),
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
      currentStep: "Ready to start",
      progressPercent: 0,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
    });

    after(async () => {
      try {
        await seedMeetingV2TranscriptSegments({
          meetingId,
          transcriptText: vttBuffer.toString("utf8"),
          storagePath: path.relative(process.cwd(), vttAbsolute).replace(/\\/g, "/"),
          originalFilename: transcriptFile.name,
        });
        console.info("[meetings:v2:upload] transcript seeded", { meetingId });
      } catch (error) {
        console.error("[meetings:v2:upload] transcript seed failed", { meetingId, error });
      }
    });

    console.info("[meetings:v2:upload] rows created", { meetingId });

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
