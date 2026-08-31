export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { isProjectHighlightModel } from "@/lib/email-analysis/project-highlight-models";
import {
  getLatestBoardReportRun,
  loadBoardReportScanReview,
  updateBoardReportRun,
} from "@/lib/projects/board-reports";
import {
  startBoardReportRematch,
  startBoardReportScan,
} from "@/lib/projects/board-report-worker";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const details =
    new URL(request.url).searchParams.get("details") === "1";

  try {
    const run = await getLatestBoardReportRun();
    if (!details || !run) {
      return NextResponse.json({ run });
    }
    const review = await loadBoardReportScanReview(run.id);
    return NextResponse.json({
      run,
      unmatchedTopics: review.unmatchedTopics,
      waitingOnMarkdown: review.waitingOnMarkdown,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load management-report scan status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: { action?: string; modelId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "cancel") {
    const run = await getLatestBoardReportRun();
    if (!run || run.status !== "running") {
      return NextResponse.json(
        { error: "No running management-report scan to cancel." },
        { status: 400 },
      );
    }
    await updateBoardReportRun(run.id, {
      status: "cancelled",
      lastError: "Cancelled from the Projects tab.",
      finishedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, runId: run.id });
  }

  if (body.action === "rematch") {
    try {
      const started = await startBoardReportRematch();
      const run = await getLatestBoardReportRun();
      return NextResponse.json({ ok: true, runId: started.runId, run });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not re-match management-report topics.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (body.action && body.action !== "start") {
    return NextResponse.json(
      {
        error:
          'Unsupported action. Use action: "start", "rematch", or "cancel".',
      },
      { status: 400 },
    );
  }

  if (body.modelId && !isProjectHighlightModel(body.modelId)) {
    return NextResponse.json({ error: "Unknown model id." }, { status: 400 });
  }

  try {
    const started = await startBoardReportScan({ modelId: body.modelId });
    const run = await getLatestBoardReportRun();
    return NextResponse.json({ ok: true, runId: started.runId, run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start management-report scan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
