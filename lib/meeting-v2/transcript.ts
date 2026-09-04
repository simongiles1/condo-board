import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

import { asc, and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  meetingsV2SourceArtifacts,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema-v2";
import {
  formatReadableTranscript,
  mergeConsecutiveBySpeaker,
  parseVttCues,
  type MergedVttCue,
  type VttCue,
} from "@/lib/parsers/vtt";

export type MeetingTranscriptPayload = {
  content: string;
  readable: string;
  cues: MergedVttCue[];
  fileName: string;
  source: "file" | "database";
};

type TranscriptSegmentRow = typeof meetingsV2TranscriptSegments.$inferSelect;

function checksumFor(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function vttTimestampToMs(value: string): number {
  const [hours = "0", minutes = "0", secondsMs = "0"] = value.split(":");
  const [seconds = "0", millis = "0"] = secondsMs.split(".");
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(millis)
  );
}

export function segmentsToCues(
  segments: Array<Pick<TranscriptSegmentRow, "startTimestamp" | "endTimestamp" | "speakerLabel" | "text">>,
): VttCue[] {
  return segments.map((segment) => ({
    start: segment.startTimestamp,
    end: segment.endTimestamp,
    speaker: segment.speakerLabel ?? "",
    text: segment.text,
  }));
}

export function segmentsToMergedCues(
  segments: Array<Pick<TranscriptSegmentRow, "startTimestamp" | "endTimestamp" | "speakerLabel" | "text">>,
): MergedVttCue[] {
  return mergeConsecutiveBySpeaker(segmentsToCues(segments));
}

export function segmentsToVtt(
  segments: Array<Pick<TranscriptSegmentRow, "startTimestamp" | "endTimestamp" | "speakerLabel" | "text">>,
): string {
  const lines = ["WEBVTT", ""];

  segments.forEach((segment, index) => {
    lines.push(String(index + 1));
    lines.push(`${segment.startTimestamp} --> ${segment.endTimestamp}`);
    const speaker = segment.speakerLabel?.trim();
    if (speaker) {
      lines.push(`<v ${speaker}>${segment.text}</v>`);
    } else {
      lines.push(segment.text);
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

export async function seedMeetingV2TranscriptSegments(options: {
  meetingId: string;
  transcriptText: string;
  storagePath: string;
  originalFilename: string;
}): Promise<void> {
  const db = getDb();
  const existingSegments = await db
    .select({ id: meetingsV2TranscriptSegments.id })
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, options.meetingId))
    .limit(1);

  if (existingSegments.length > 0) {
    return;
  }

  const transcriptBuffer = Buffer.from(options.transcriptText, "utf8");
  const createdAt = new Date().toISOString();
  const [existingTranscriptArtifact] = await db
    .select()
    .from(meetingsV2SourceArtifacts)
    .where(
      and(
        eq(meetingsV2SourceArtifacts.meetingV2Id, options.meetingId),
        eq(meetingsV2SourceArtifacts.type, "transcript"),
      ),
    );

  let transcriptArtifact = existingTranscriptArtifact ?? null;

  if (!transcriptArtifact) {
    transcriptArtifact = {
      id: randomUUID(),
      meetingV2Id: options.meetingId,
      type: "transcript",
      referenceClassification: null,
      originalFilename: options.originalFilename,
      mimeType: "text/vtt",
      storagePath: options.storagePath,
      checksum: checksumFor(transcriptBuffer),
      sizeBytes: transcriptBuffer.byteLength,
      pageCount: null,
      createdAt,
    };
    await db.insert(meetingsV2SourceArtifacts).values(transcriptArtifact);
  }

  const transcriptCues = parseVttCues(options.transcriptText);
  if (transcriptCues.length === 0) {
    return;
  }

  const segmentRows = transcriptCues.map((cue, index) => ({
    id: randomUUID(),
    meetingV2Id: options.meetingId,
    sourceArtifactId: transcriptArtifact.id,
    sequence: index,
    startMs: vttTimestampToMs(cue.start),
    endMs: vttTimestampToMs(cue.end),
    startTimestamp: cue.start,
    endTimestamp: cue.end,
    speakerLabel: cue.speaker || null,
    text: cue.text,
    rawCueId: null,
  })) satisfies Array<typeof meetingsV2TranscriptSegments.$inferInsert>;

  await db.insert(meetingsV2TranscriptSegments).values(segmentRows);
}

export async function loadMeetingTranscript(
  meetingId: string,
): Promise<
  | { ok: true; payload: MeetingTranscriptPayload }
  | { ok: false; status: number; error: string }
> {
  const db = getDb();

  const [meeting] = await db
    .select({ vttFilePath: meetings.vttFilePath })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting) {
    return { ok: false, status: 404, error: "Meeting not found." };
  }

  const fileName = path.basename(meeting.vttFilePath);
  const absolute = path.resolve(process.cwd(), meeting.vttFilePath);
  const uploadRoot = path.resolve(process.cwd(), "uploads", meetingId);

  if (absolute.startsWith(uploadRoot)) {
    try {
      const content = await readFile(absolute, "utf8");
      const cues = mergeConsecutiveBySpeaker(parseVttCues(content));

      return {
        ok: true,
        payload: {
          content,
          readable: formatReadableTranscript(cues),
          cues,
          fileName,
          source: "file",
        },
      };
    } catch {
      // Fall back to database segments when the upload exists only on another server.
    }
  }

  const segments = await db
    .select()
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2TranscriptSegments.sequence));

  if (segments.length === 0) {
    return {
      ok: false,
      status: 404,
      error:
        "Transcript is not available on this server yet. If this meeting was uploaded in production, open it there—or run source ingestion so transcript segments are stored in the shared database.",
    };
  }

  const cues = segmentsToMergedCues(segments);

  return {
    ok: true,
    payload: {
      content: segmentsToVtt(segments),
      readable: formatReadableTranscript(cues),
      cues,
      fileName,
      source: "database",
    },
  };
}
