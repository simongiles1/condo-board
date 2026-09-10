export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  cancelFileCardRun,
  getFileCardRun,
} from "@/lib/rag/file-card-runs";
import { isFileCardWorkerAlive } from "@/lib/rag/file-card-worker";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await context.params;
    const run = await getFileCardRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      run: {
        ...run,
        workerAlive: isFileCardWorkerAlive(run.id),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not fetch file card run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (body.action === "cancel") {
      const cancelled = await cancelFileCardRun(id);
      return NextResponse.json({ run: cancelled });
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update file card run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
