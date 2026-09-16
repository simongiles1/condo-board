import { NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";
import {
  applyGoldStandardToMinutesPipeline,
  deleteSegmentCompareRun,
  loadSegmentCompareWorkspace,
  queueSegmentCompareRun,
  setSegmentCompareReviewedKeys,
  setSegmentGoldStandard,
} from "@/lib/meeting-v2/segment-compare";
import {
  SEGMENT_COMPARE_MODELS,
  isSegmentCompareModelId,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";

function parseChoice(value: unknown, label: string): SegmentCompareSlotChoice {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} is required.`);
  }
  const record = value as Record<string, unknown>;
  const modelId = typeof record.modelId === "string" ? record.modelId : "";
  if (!isSegmentCompareModelId(modelId)) {
    throw new Error(`${label} model is not supported.`);
  }
  return {
    modelId,
    thinking: Boolean(record.thinking),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspace = await loadSegmentCompareWorkspace(id);
    return NextResponse.json(
      { models: SEGMENT_COMPARE_MODELS, ...workspace },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[v2/segment-compare GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load segment compare" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      walk?: unknown;
      edge?: unknown;
      action?: unknown;
    };
    if (body.action === "run-pipeline-from-gold") {
      const applied = await applyGoldStandardToMinutesPipeline(id);
      try {
        await inngest.send({
          name: "meeting-v2/pipeline.start",
          data: { meetingId: id },
        });
      } catch (error) {
        throw error;
      }
      return NextResponse.json({ ok: true, ...applied }, { status: 202 });
    }
    const walk = parseChoice(body.walk, "Segmenter");
    const edge = parseChoice(body.edge, "Edge detection");
    const run = await queueSegmentCompareRun({ meetingId: id, walk, edge });
    try {
      await inngest.send({
        name: "meeting-v2/segment-compare.start",
        data: { meetingId: id, runId: run.id },
      });
    } catch (error) {
      await deleteSegmentCompareRun(id, run.id);
      throw error;
    }
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start segment compare";
    const status = /already in progress/i.test(message)
      ? 409
      : /gold-standard/i.test(message)
        ? 400
        : 400;
    console.error("[v2/segment-compare POST]", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { reviewedKeys?: unknown; goldSpans?: unknown };
    if (Array.isArray(body.goldSpans)) {
      const spans = body.goldSpans.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.agendaItemId !== "string") return [];
        const startSeconds = Number(record.startSeconds);
        const endSeconds = Number(record.endSeconds);
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return [];
        return [{ agendaItemId: record.agendaItemId, startSeconds, endSeconds }];
      });
      const goldStandard = await setSegmentGoldStandard(id, spans);
      return NextResponse.json({ goldStandard });
    }
    if (!Array.isArray(body.reviewedKeys)) {
      return NextResponse.json({ error: "reviewedKeys must be an array" }, { status: 400 });
    }
    const reviewedKeys = body.reviewedKeys.filter((key): key is string => typeof key === "string");
    const saved = await setSegmentCompareReviewedKeys(id, reviewedKeys);
    return NextResponse.json({ reviewedKeys: saved });
  } catch (error) {
    console.error("[v2/segment-compare PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update reviewed combinations" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const runId = new URL(req.url).searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    await deleteSegmentCompareRun(id, runId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[v2/segment-compare DELETE]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete run" },
      { status: 500 },
    );
  }
}
