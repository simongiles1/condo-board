export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  getDoclingBackfillRun,
  resumeDoclingBackfillRun,
} from "@/lib/email/docling-backfill-runs";
import { kickDoclingBackfillWorker, withWorkerAlive } from "@/lib/email/docling-backfill-worker";
import { checkDoclingProviderHealth } from "@/lib/email/docling-lab";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { id } = await context.params;
    const existing = await getDoclingBackfillRun(id);
    if (!existing) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    if (existing.status === "running") {
      kickDoclingBackfillWorker(existing.id);
      return NextResponse.json({ run: withWorkerAlive(existing) });
    }

    if (existing.mode === "docling_only" || existing.mode === "full") {
      const health = await checkDoclingProviderHealth(existing.doclingProvider);
      if (!health.ok) {
        return NextResponse.json(
          {
            error:
              existing.doclingProvider === "ibm"
                ? `IBM Docling not ready${health.url ? ` at ${health.url}` : ""}. ${health.detail ?? "Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (plus _2 / _3 / _4)."}`
                : `Docling sidecar not reachable at ${health.url}. ` +
                  `Run \`npm run docling:sidecar\`.` +
                  (health.detail ? ` (${health.detail})` : ""),
          },
          { status: 503 },
        );
      }
    }

    const run = await resumeDoclingBackfillRun(id);
    kickDoclingBackfillWorker(run.id);
    return NextResponse.json({ run: withWorkerAlive(run) });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not resume extraction backfill run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
