export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  createFileCardRun,
  listFileCardRuns,
  planFileCardTargets,
  type FileCardRunScope,
} from "@/lib/rag/file-card-runs";
import { isFileCardWorkerAlive, kickFileCardWorker } from "@/lib/rag/file-card-worker";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    const runs = await listFileCardRuns(limit);
    const enriched = runs.map((r) => ({
      ...r,
      workerAlive: isFileCardWorkerAlive(r.id),
    }));

    return NextResponse.json({ runs: enriched });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list file card runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = await request.json();
    const scope: FileCardRunScope =
      body.scope === "target_emails" || body.scope === "pending_corpus"
        ? body.scope
        : "test";

    const docLimit =
      typeof body.docLimit === "number" && body.docLimit > 0
        ? body.docLimit
        : scope === "test"
          ? 5
          : null;

    const emailIds = Array.isArray(body.emailIds)
      ? body.emailIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : [];

    const forceOverwrite = Boolean(body.forceOverwrite);

    const plannedDocs = await planFileCardTargets({
      scope,
      docLimit,
      emailIds,
      forceOverwrite,
    });

    if (plannedDocs.length === 0) {
      return NextResponse.json(
        { error: "No matching parsed attachments found for this scope." },
        { status: 400 },
      );
    }

    const run = await createFileCardRun({
      scope,
      docLimit,
      plannedDocs,
      emailIds,
    });

    kickFileCardWorker(run.id, { forceOverwrite });

    return NextResponse.json({
      run: {
        ...run,
        workerAlive: true,
      },
      plannedCount: plannedDocs.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start file card run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
