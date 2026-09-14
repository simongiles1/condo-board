export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  cancelDocumentSeriesRun,
  countReadyFileCards,
  getLatestDocumentSeriesRun,
  listDocumentSeries,
} from "@/lib/documents/series";
import {
  isDocumentSeriesWorkerAlive,
  startDocumentSeriesDiscovery,
} from "@/lib/documents/series-worker";
import { listOutboundFileLinkEmails } from "@/lib/email/outbound-file-links";

export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const [series, latestRun, fileCardCount, linkedResult] = await Promise.all([
      listDocumentSeries(),
      getLatestDocumentSeriesRun(),
      countReadyFileCards(),
      listOutboundFileLinkEmails().catch((error) => {
        console.error("[documents:series:linked-files]", error);
        return [];
      }),
    ]);
    return NextResponse.json({
      series,
      fileCardCount,
      linkedFiles: linkedResult,
      run: latestRun
        ? {
            ...latestRun,
            workerAlive: isDocumentSeriesWorkerAlive(latestRun.id),
          }
        : null,
    });
  } catch (error) {
    console.error("[documents:series:list]", error);
    return NextResponse.json(
      { error: "Could not load recurring document types." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      runId?: string;
    };

    if (body.action === "cancel" && body.runId) {
      const cancelled = await cancelDocumentSeriesRun(body.runId);
      return NextResponse.json({ cancelled });
    }

    const fileCardCount = await countReadyFileCards();
    if (fileCardCount === 0) {
      return NextResponse.json(
        {
          error:
            "No file cards yet. Create file cards from Extraction lab first, then find recurring types.",
        },
        { status: 400 },
      );
    }

    const started = await startDocumentSeriesDiscovery();
    return NextResponse.json({ runId: started.runId });
  } catch (error) {
    console.error("[documents:series:start]", error);
    return NextResponse.json(
      { error: "Could not start recurring-type discovery." },
      { status: 500 },
    );
  }
}
