import { access } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";

export type MeetingSourceFileKind = "transcript" | "board-package" | "reference-pdf";

export type MeetingSourceFileTarget = {
  kind: MeetingSourceFileKind;
  relativePath: string;
  fileName: string;
  existsLocally: boolean;
};

function normalizeRelativePath(storedPath: string): string {
  return storedPath.trim().replaceAll("\\", "/");
}

function isPathWithinUploadRoot(relativePath: string, meetingId: string): boolean {
  const absolute = path.resolve(process.cwd(), relativePath);
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

export async function listMeetingSourceFileTargets(
  meetingId: string,
): Promise<
  | { ok: true; targets: MeetingSourceFileTarget[] }
  | { ok: false; status: number; error: string }
> {
  const db = getDb();
  const [meeting] = await db
    .select({
      vttFilePath: meetings.vttFilePath,
      boardPackageFilePath: meetings.boardPackageFilePath,
      pdfFilePath: meetings.pdfFilePath,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting) {
    return { ok: false, status: 404, error: "Meeting not found." };
  }

  const boardPackagePath =
    meeting.boardPackageFilePath?.trim() || meeting.pdfFilePath?.trim() || null;

  const candidates: Array<{ kind: MeetingSourceFileKind; relativePath: string | null }> = [
    { kind: "transcript", relativePath: meeting.vttFilePath },
    { kind: "board-package", relativePath: boardPackagePath },
    {
      kind: "reference-pdf",
      relativePath:
        meeting.pdfFilePath &&
        normalizeRelativePath(meeting.pdfFilePath) !==
          normalizeRelativePath(boardPackagePath ?? "")
          ? meeting.pdfFilePath
          : null,
    },
  ];

  const targets: MeetingSourceFileTarget[] = [];

  for (const candidate of candidates) {
    const relativePath = candidate.relativePath?.trim();
    if (!relativePath) continue;

    const normalized = normalizeRelativePath(relativePath);
    if (!isPathWithinUploadRoot(normalized, meetingId)) {
      continue;
    }

    const absolute = path.resolve(process.cwd(), normalized);
    targets.push({
      kind: candidate.kind,
      relativePath: normalized,
      fileName: path.basename(normalized),
      existsLocally: await fileExists(absolute),
    });
  }

  return { ok: true, targets };
}

export async function resolveMeetingSourceFileTarget(
  meetingId: string,
  kind: MeetingSourceFileKind,
): Promise<
  | { ok: true; target: MeetingSourceFileTarget }
  | { ok: false; status: number; error: string }
> {
  const listed = await listMeetingSourceFileTargets(meetingId);
  if (!listed.ok) {
    return listed;
  }

  const target = listed.targets.find((entry) => entry.kind === kind);
  if (!target) {
    return {
      ok: false,
      status: 404,
      error: `No ${kind} path is registered for this meeting.`,
    };
  }

  return { ok: true, target };
}
