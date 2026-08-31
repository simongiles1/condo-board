export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  getLatestIdentityReviewRun,
  updateIdentityReviewRun,
} from "@/lib/projects/identity-review";
import {
  identityReviewWorkerIsActive,
  refreshRegistryAfterIdentityReview,
  startIdentityReviewRun,
} from "@/lib/projects/identity-review-worker";
import { isProjectHighlightModel } from "@/lib/email-analysis/project-highlight-models";

export async function GET() {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  try {
    const run = await getLatestIdentityReviewRun();
    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load identity review status.";
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
    const run = await getLatestIdentityReviewRun();
    if (!run || run.status !== "running") {
      return NextResponse.json(
        { error: "No running identity review to cancel." },
        { status: 400 },
      );
    }
    await updateIdentityReviewRun(run.id, {
      status: "cancelled",
      lastError: "Cancelled from the Projects Duplicates tab.",
      finishedAt: new Date().toISOString(),
    });
    if (!identityReviewWorkerIsActive(run.id)) {
      void refreshRegistryAfterIdentityReview(run.id);
    }
    return NextResponse.json({ ok: true, runId: run.id });
  }

  if (body.action && body.action !== "start") {
    return NextResponse.json(
      { error: 'Unsupported action. Use action: "start" or "cancel".' },
      { status: 400 },
    );
  }

  if (body.modelId && !isProjectHighlightModel(body.modelId)) {
    return NextResponse.json({ error: "Unknown model id." }, { status: 400 });
  }

  try {
    const started = await startIdentityReviewRun({ modelId: body.modelId });
    const run = await getLatestIdentityReviewRun();
    return NextResponse.json({ ok: true, runId: started.runId, run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start identity review.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
