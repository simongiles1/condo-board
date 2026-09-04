import { access, readFile } from "fs/promises";
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

function isPathWithinUploadRoot(absolute: string, meetingId: string): boolean {
  const uploadRoot = path.resolve(process.cwd(), "uploads", meetingId);
  const normalizedAbsolute = path.normalize(absolute);
  const normalizedRoot = path.normalize(uploadRoot);
  if (process.platform === "win32") {
    const absoluteLower = normalizedAbsolute.toLowerCase();
    const rootLower = normalizedRoot.toLowerCase();
    return (
      absoluteLower === rootLower ||
      absoluteLower.startsWith(`${rootLower}${path.sep}`)
    );
  }
  return (
    normalizedAbsolute === normalizedRoot ||
    normalizedAbsolute.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
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
  const inUploadRoot = Boolean(absolute && isPathWithinUploadRoot(absolute, meetingId));
  const available = inUploadRoot && absolute ? await fileExists(absolute) : false;

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

  if (!absolute || !isPathWithinUploadRoot(absolute, meetingId)) {
    return {
      ok: false,
      status: 404,
      error:
        "Board package PDF is not available on this server. If the meeting was uploaded in production, open it there.",
    };
  }

  if (!(await fileExists(absolute))) {
    return {
      ok: false,
      status: 404,
      error:
        "Board package metadata exists in the database, but the PDF file is not on this machine. Open the meeting where it was uploaded, or create a new local upload.",
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown read error";
    return {
      ok: false,
      status: 404,
      error: `Could not read the uploaded board package PDF (${detail}).`,
    };
  }
}
