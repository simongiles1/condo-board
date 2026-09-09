import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2PipelineSegmentDurations } from "@/lib/db/schema";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";

/** Automated pipeline segments that contribute to the 0–90% progress bar. */
export const MEETING_V2_PIPELINE_SEGMENTS = [
  "ingest",
  "extract",
  "evidence",
  "investigate",
  "validate",
] as const;

export type MeetingV2PipelineSegment = (typeof MEETING_V2_PIPELINE_SEGMENTS)[number];

/** Legacy fixed spans — used until enough duration samples exist per segment. */
export const MEETING_V2_DEFAULT_SEGMENT_WEIGHTS: Record<MeetingV2PipelineSegment, number> = {
  ingest: 20,
  extract: 20,
  evidence: 20,
  investigate: 20,
  validate: 10,
};

/** Automated pipeline ends at 90%; agenda review and draft use the remaining 10%. */
export const MEETING_V2_PIPELINE_COMPLETE_PERCENT = 90;

export const MEETING_V2_MIN_SEGMENT_DURATION_SAMPLES = 2;

export type MeetingV2PipelineSegmentBounds = {
  basePercent: number;
  spanPercent: number;
};

export type MeetingV2PipelineSegmentAverage = {
  avgMs: number;
  sampleCount: number;
};

const PIPELINE_STATE_TO_SEGMENT: Partial<
  Record<string, MeetingV2PipelineSegment>
> = {
  ingesting: "ingest",
  ingested: "ingest",
  extracting: "extract",
  extracted: "extract",
  gathering_evidence: "evidence",
  evidence_gathered: "evidence",
  investigating: "investigate",
  investigated: "investigate",
  validating: "validate",
};

export function resolvePipelineSegmentFromState(
  pipelineState: string,
): MeetingV2PipelineSegment | null {
  return PIPELINE_STATE_TO_SEGMENT[pipelineState] ?? null;
}

export function computeSegmentWeightsFromAverages(
  averages: Partial<Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentAverage>>,
): Record<MeetingV2PipelineSegment, number> {
  const weights: Record<MeetingV2PipelineSegment, number> = {
    ...MEETING_V2_DEFAULT_SEGMENT_WEIGHTS,
  };

  for (const segment of MEETING_V2_PIPELINE_SEGMENTS) {
    const average = averages[segment];
    if (
      average &&
      average.sampleCount >= MEETING_V2_MIN_SEGMENT_DURATION_SAMPLES &&
      average.avgMs > 0
    ) {
      weights[segment] = average.avgMs;
    }
  }

  return weights;
}

export function computeSegmentProgressBounds(
  segmentWeights: Record<MeetingV2PipelineSegment, number>,
): Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds> {
  const totalWeight = MEETING_V2_PIPELINE_SEGMENTS.reduce(
    (sum, segment) => sum + Math.max(0, segmentWeights[segment]),
    0,
  );
  const normalizedTotal = totalWeight > 0 ? totalWeight : 1;

  const bounds: Partial<
    Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds>
  > = {};
  let cursor = 0;

  for (const segment of MEETING_V2_PIPELINE_SEGMENTS) {
    const spanPercent = Math.round(
      (Math.max(0, segmentWeights[segment]) / normalizedTotal) *
        MEETING_V2_PIPELINE_COMPLETE_PERCENT,
    );
    bounds[segment] = {
      basePercent: cursor,
      spanPercent,
    };
    cursor += spanPercent;
  }

  const lastSegment = MEETING_V2_PIPELINE_SEGMENTS.at(-1);
  if (lastSegment && bounds[lastSegment]) {
    const drift = MEETING_V2_PIPELINE_COMPLETE_PERCENT - cursor;
    bounds[lastSegment] = {
      ...bounds[lastSegment],
      spanPercent: bounds[lastSegment].spanPercent + drift,
    };
  }

  return bounds as Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds>;
}

export function computeIntraSegmentRatio(options: {
  current: number;
  total: number;
  segmentStartedAtMs: number | null;
  expectedSegmentDurationMs: number | null;
  nowMs?: number;
}): number {
  const { current, total, segmentStartedAtMs, expectedSegmentDurationMs } = options;
  const nowMs = options.nowMs ?? Date.now();

  const chunkRatio = total <= 0 ? 1 : Math.max(0, Math.min(1, current / total));

  if (
    segmentStartedAtMs === null ||
    expectedSegmentDurationMs === null ||
    expectedSegmentDurationMs <= 0
  ) {
    return chunkRatio;
  }

  const elapsedRatio = Math.max(
    0,
    Math.min(1, (nowMs - segmentStartedAtMs) / expectedSegmentDurationMs),
  );

  return Math.max(chunkRatio, elapsedRatio);
}

export function computePipelineProgressPercent(options: {
  segment: MeetingV2PipelineSegment;
  current: number;
  total: number;
  segmentBounds: Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds>;
  segmentStartedAtMs: number | null;
  expectedSegmentDurationMs: number | null;
  nowMs?: number;
}): number {
  const bounds = options.segmentBounds[options.segment];
  const ratio = computeIntraSegmentRatio({
    current: options.current,
    total: options.total,
    segmentStartedAtMs: options.segmentStartedAtMs,
    expectedSegmentDurationMs: options.expectedSegmentDurationMs,
    nowMs: options.nowMs,
  });

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(bounds.basePercent + bounds.spanPercent * ratio),
    ),
  );
}

export async function loadMeetingV2PipelineSegmentAverages(): Promise<
  Partial<Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentAverage>>
> {
  const db = getDb();
  const rows = await db
    .select({
      segment: meetingsV2PipelineSegmentDurations.segment,
      avgMs: sql<number>`round(avg(${meetingsV2PipelineSegmentDurations.durationMs}))`,
      sampleCount: sql<number>`count(*)::int`,
    })
    .from(meetingsV2PipelineSegmentDurations)
    .groupBy(meetingsV2PipelineSegmentDurations.segment);

  const averages: Partial<
    Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentAverage>
  > = {};
  for (const row of rows) {
    if (!MEETING_V2_PIPELINE_SEGMENTS.includes(row.segment as MeetingV2PipelineSegment)) {
      continue;
    }
    averages[row.segment as MeetingV2PipelineSegment] = {
      avgMs: Number(row.avgMs) || 0,
      sampleCount: Number(row.sampleCount) || 0,
    };
  }
  return averages;
}

export async function recordMeetingV2PipelineSegmentDuration(
  meetingId: string,
  segment: MeetingV2PipelineSegment,
  durationMs: number,
): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;

  const db = getDb();
  await db.insert(meetingsV2PipelineSegmentDurations).values({
    id: randomUUID(),
    meetingV2Id: meetingId,
    segment,
    durationMs: Math.round(durationMs),
    recordedAt: new Date().toISOString(),
  });

  console.info("[meetings:v2:timing] recorded segment duration", {
    meetingId,
    segment,
    durationMs: Math.round(durationMs),
  });
}

export async function markMeetingV2PipelineSegmentStarted(
  meetingId: string,
  segment: MeetingV2PipelineSegment,
): Promise<void> {
  const db = getDb();
  const [meeting] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = (meeting?.settings as MeetingV2Settings) || {};

  await db
    .update(meetingsV2)
    .set({
      settings: {
        ...settings,
        pipelineTiming: {
          segment,
          startedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

export async function readMeetingV2PipelineSegmentStartedAt(
  meetingId: string,
  segment: MeetingV2PipelineSegment,
): Promise<number | null> {
  const db = getDb();
  const [meeting] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = (meeting?.settings as MeetingV2Settings) || {};
  const timing = settings.pipelineTiming;
  if (!timing || timing.segment !== segment) return null;

  const startedMs = Date.parse(timing.startedAt);
  return Number.isFinite(startedMs) ? startedMs : null;
}

export async function resolveMeetingV2PipelineProgressBounds(): Promise<
  Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds>
> {
  const averages = await loadMeetingV2PipelineSegmentAverages();
  const weights = computeSegmentWeightsFromAverages(averages);
  return computeSegmentProgressBounds(weights);
}

export function getSegmentMilestonePercent(
  segmentBounds: Record<MeetingV2PipelineSegment, MeetingV2PipelineSegmentBounds>,
  segment: MeetingV2PipelineSegment,
  position: "start" | "end",
): number {
  const bounds = segmentBounds[segment];
  return position === "start" ? bounds.basePercent : bounds.basePercent + bounds.spanPercent;
}

export async function resolveMeetingV2SegmentMilestonePercent(
  segment: MeetingV2PipelineSegment,
  position: "start" | "end",
): Promise<number> {
  const bounds = await resolveMeetingV2PipelineProgressBounds();
  return getSegmentMilestonePercent(bounds, segment, position);
}

export async function runTimedMeetingV2PipelineSegment<T>(
  meetingId: string,
  segment: MeetingV2PipelineSegment,
  work: () => Promise<T>,
): Promise<T> {
  await markMeetingV2PipelineSegmentStarted(meetingId, segment);
  const startedAtMs = Date.now();
  try {
    return await work();
  } finally {
    await recordMeetingV2PipelineSegmentDuration(
      meetingId,
      segment,
      Date.now() - startedAtMs,
    );
  }
}
