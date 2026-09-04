import { readFile } from "fs/promises";
import path from "path";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { meetingsV2SourceArtifacts } from "@/lib/db/schema-v2";

export type MeetingBoardPackageMeta = {
  fileName: string;
  pageCount: number | null;
  sizeBytes: number | null;
  available: boolean;
  source: "file" | "metadata";
};

export type MeetingBoardPackagePayload = {
  buffer: Buffer;
  fileName: string;
  pageCount: number | null;
  source: "file";
};

function resolveStoredPath(storedPath: string | null | undefined): string | null {
  if (!storedPath?.trim()) return null;
  return path.resolve(process.cwd(), storedPath);
}

export async function loadMeetingBoardPackageMeta(
  meetingId: string,
): Promise<
  | { ok: true; payload: MeetingBoardPackageMeta }
  | { ok: false; status: number; error: string }
> {
  const db = getDb();

  const [meeting] = await db
    .select({
      boardPackageFilePath: meetings.boardPackageFilePath,
      pdfFilePath: meetings.pdfFilePath,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting) {
    return { ok: false, status: 404, error: "Meeting not found." };
  }

  const [artifact] = await db
    .select({
      originalFilename: meetingsV2SourceArtifacts.originalFilename,
      pageCount: meetingsV2SourceArtifacts.pageCount,
      sizeBytes: meetingsV2SourceArtifacts.sizeBytes,
      storagePath: meetingsV2SourceArtifacts.storagePath,
    })
    .from(meetingsV2SourceArtifacts)
    .where(
      and(
        eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
        eq(meetingsV2SourceArtifacts.type, "board_package"),
      ),
    );

  const storedPath =
    meeting.boardPackageFilePath?.trim() ||
    meeting.pdfFilePath?.trim() ||
    artifact?.storagePath ||
    null;
  const fileName =
    artifact?.originalFilename?.trim() ||
    (storedPath ? path.basename(storedPath) : "board-package.pdf");
  const absolute = resolveStoredPath(storedPath);
  const uploadRoot = path.resolve(process.cwd(), "uploads", meetingId);
  const available = Boolean(absolute?.startsWith(uploadRoot));

  return {
    ok: true,
    payload: {
      fileName,
      pageCount: artifact?.pageCount ?? null,
      sizeBytes: artifact?.sizeBytes ?? null,
      available,
      source: available ? "file" : "metadata",
    },
  };
}

export async function loadMeetingBoardPackage(
  meetingId: string,
): Promise<
  | { ok: true; payload: MeetingBoardPackagePayload }
  | { ok: false; status: number; error: string }
> {
  const meta = await loadMeetingBoardPackageMeta(meetingId);
  if (!meta.ok) {
    return meta;
  }

  const db = getDb();
  const [meeting] = await db
    .select({
      boardPackageFilePath: meetings.boardPackageFilePath,
      pdfFilePath: meetings.pdfFilePath,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting) {
    return { ok: false, status: 404, error: "Meeting not found." };
  }

  const [artifact] = await db
    .select({
      originalFilename: meetingsV2SourceArtifacts.originalFilename,
      pageCount: meetingsV2SourceArtifacts.pageCount,
      storagePath: meetingsV2SourceArtifacts.storagePath,
    })
    .from(meetingsV2SourceArtifacts)
    .where(
      and(
        eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
        eq(meetingsV2SourceArtifacts.type, "board_package"),
      ),
    );

  const storedPath =
    meeting.boardPackageFilePath?.trim() ||
    meeting.pdfFilePath?.trim() ||
    artifact?.storagePath ||
    null;
  const absolute = resolveStoredPath(storedPath);
  const uploadRoot = path.resolve(process.cwd(), "uploads", meetingId);

  if (!absolute || !absolute.startsWith(uploadRoot)) {
    return {
      ok: false,
      status: 404,
      error:
        "Board package PDF is not available on this server. If the meeting was uploaded in production, open it there.",
    };
  }

  try {
    const buffer = await readFile(absolute);
    const fileName =
      artifact?.originalFilename?.trim() || path.basename(absolute) || "board-package.pdf";

    return {
      ok: true,
      payload: {
        buffer,
        fileName,
        pageCount: artifact?.pageCount ?? null,
        source: "file",
      },
    };
  } catch {
    return {
      ok: false,
      status: 404,
      error: "Could not read the uploaded board package PDF.",
    };
  }
}
