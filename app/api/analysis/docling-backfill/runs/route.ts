export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  createDoclingBackfillRun,
  listDoclingBackfillRuns,
} from "@/lib/email/docling-backfill-runs";
import { kickDoclingBackfillWorker, withWorkerAlive } from "@/lib/email/docling-backfill-worker";
import {
  isExtractionBackfillMode,
  planExtractionBackfill,
  type ExtractionBackfillMode,
} from "@/lib/email/extraction-backfill-plan";
import { checkDoclingProviderHealth } from "@/lib/email/docling-lab";
import { isDoclingProvider, DEFAULT_DOCLING_PROVIDER, type DoclingProvider } from "@/lib/email/docling-provider";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "40");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 40;
    const runs = await listDoclingBackfillRuns(limit);
    return NextResponse.json({ runs: runs.map(withWorkerAlive) });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not list extraction backfill runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: unknown;
      doclingProvider?: unknown;
      docLimit?: unknown;
      all?: unknown;
    };

    const mode: ExtractionBackfillMode = isExtractionBackfillMode(body.mode)
      ? body.mode
      : "full";
    const doclingProvider: DoclingProvider = isDoclingProvider(
      body.doclingProvider,
    )
      ? body.doclingProvider
      : DEFAULT_DOCLING_PROVIDER;

    const all = body.all === true;
    let docLimit: number | null = null;
    if (!all) {
      const raw =
        typeof body.docLimit === "number"
          ? body.docLimit
          : Number(body.docLimit ?? 10);
      if (!Number.isFinite(raw) || raw < 1 || raw > 10_000) {
        return NextResponse.json(
          { error: "docLimit must be an integer from 1 to 10000." },
          { status: 400 },
        );
      }
      docLimit = Math.floor(raw);
    }

    if (mode === "docling_only" || mode === "full") {
      const health = await checkDoclingProviderHealth(doclingProvider);
      if (!health.ok) {
        return NextResponse.json(
          {
            error:
              doclingProvider === "ibm"
                ? `IBM Docling not ready${health.url ? ` at ${health.url}` : ""}. ${health.detail ?? "Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (plus _2 / _3 / _4) in .env.local."}`
                : `Docling sidecar not reachable at ${health.url}. ` +
                  `Run \`npm run docling:sidecar\` in another terminal.` +
                  (health.detail ? ` (${health.detail})` : ""),
          },
          { status: 503 },
        );
      }
    }

    const plan = await planExtractionBackfill({ mode, docLimit });
    if (plan.docs.length === 0) {
      return NextResponse.json(
        {
          error:
            plan.missingPdfDocs > 0
              ? `No cached files for ${plan.missingPdfDocs} doc(s) with pending work.`
              : mode === "vision_only"
                ? "No pending/failed vision pages to process."
                : mode === "docling_only"
                  ? "No uncached text-route pages to backfill."
                  : "No Docling or vision work remaining.",
        },
        { status: 400 },
      );
    }

    const run = await createDoclingBackfillRun({
      mode,
      doclingProvider,
      docLimit,
      plannedHashes: plan.docs.map((d) => d.contentHash),
      totalDoclingPages: plan.totalDoclingPages,
      totalVisionPages: plan.totalVisionPages,
      corpusUncachedPages: plan.corpusUncachedDoclingPages,
      corpusPendingDocs: plan.corpusPendingDoclingDocs,
      corpusPendingVisionPages: plan.corpusPendingVisionPages,
      corpusPendingVisionDocs: plan.corpusPendingVisionDocs,
    });

    kickDoclingBackfillWorker(run.id);

    return NextResponse.json({ run: withWorkerAlive(run), planSummary: {
      docs: plan.docs.length,
      doclingPages: plan.totalDoclingPages,
      visionPages: plan.totalVisionPages,
    }});
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start extraction backfill run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
