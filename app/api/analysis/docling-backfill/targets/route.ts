export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { summarizeVisionBackfillCorpus } from "@/lib/email/extraction-backfill-plan";
import {
  checkDoclingSidecarHealth,
  summarizeDoclingBackfillCorpus,
} from "@/lib/email/docling-lab";
import { checkIbmDoclingHealth } from "@/lib/email/docling-ibm";

/** Fast corpus + sidecar health for the Extraction lab modal. */
export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const [docling, vision, sidecar, ibm] = await Promise.all([
      summarizeDoclingBackfillCorpus(),
      summarizeVisionBackfillCorpus(),
      checkDoclingSidecarHealth(),
      checkIbmDoclingHealth(),
    ]);
    return NextResponse.json({
      textRouteDocs: docling.textRouteDocs,
      textRoutePages: docling.textRoutePages,
      cachedDoclingPages: docling.cachedDoclingPages,
      uncachedDoclingPages: docling.uncachedDoclingPages,
      pendingDoclingDocs: docling.pendingDoclingDocs,
      doneDoclingDocs: docling.doneDoclingDocs,
      totalVisionDocs: vision.totalVisionDocs,
      totalVisionPages: vision.totalVisionPages,
      doneVisionPages: vision.doneVisionPages,
      pendingVisionDocs: vision.pendingVisionDocs,
      pendingVisionPages: vision.pendingVisionPages,
      queuedVisionPages: vision.queuedVisionPages,
      failedVisionPages: vision.failedVisionPages,
      sidecar: {
        ok: sidecar.ok,
        url: sidecar.sidecarUrl,
        detail: sidecar.detail ?? null,
      },
      ibm: {
        ok: ibm.ok,
        configured: ibm.configured,
        url: ibm.url,
        detail: ibm.detail ?? null,
        keyCount: ibm.keyCount ?? 0,
        activeSlot: ibm.activeSlot ?? null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load extraction backfill targets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
