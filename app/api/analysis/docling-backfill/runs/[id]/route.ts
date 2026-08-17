export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  getDoclingBackfillRun,
  updateDoclingBackfillRun,
} from "@/lib/email/docling-backfill-runs";
import { withWorkerAlive } from "@/lib/email/docling-backfill-worker";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await context.params;
    const poll = new URL(request.url).searchParams.get("poll") === "1";
    const run = await getDoclingBackfillRun(id, {
      includeVisionErrors: !poll,
    });
    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const payload = poll ? { ...run, plannedHashes: [] as string[] } : run;
    return NextResponse.json({ run: withWorkerAlive(payload) });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load Docling backfill run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: string;
      lastError?: string | null;
    };

    if (body.status !== "cancelled") {
      return NextResponse.json(
        { error: "Only status=cancelled is supported via PATCH." },
        { status: 400 },
      );
    }

    const existing = await getDoclingBackfillRun(id);
    if (!existing) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    if (existing.status !== "running") {
      return NextResponse.json({ run: withWorkerAlive(existing) });
    }

    const run = await updateDoclingBackfillRun(id, {
      status: "cancelled",
      lastError: body.lastError ?? "Cancelled by user.",
    });
    return NextResponse.json({ run: run ? withWorkerAlive(run) : run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not update Docling backfill run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
