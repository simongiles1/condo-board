export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  estimateFileCardCostContext,
  getFileCardCorpusSummary,
  getFileCardPerDocEstimateBasis,
  planFileCardTargets,
  type FileCardRunScope,
} from "@/lib/rag/file-card-runs";

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = await request.json().catch(() => ({}));
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

    const perDocBasis = await getFileCardPerDocEstimateBasis();
    const costContext = estimateFileCardCostContext(
      plannedDocs.length,
      Date.now(),
      perDocBasis,
    );

    const corpusPlanned = await planFileCardTargets({
      scope: "pending_corpus",
      forceOverwrite,
    });
    const corpusCostContext = estimateFileCardCostContext(
      corpusPlanned.length,
      Date.now(),
      perDocBasis,
    );

    const corpusSummary = await getFileCardCorpusSummary();

    return NextResponse.json({
      targetCount: plannedDocs.length,
      corpusTargetCount: corpusPlanned.length,
      corpusSummary,
      costContext,
      corpusCostContext,
      sampleTargets: plannedDocs.slice(0, 10).map((d) => ({
        contentHash: d.contentHash,
        filename: d.filename,
        emailId: d.emailId,
        subject: d.subject,
        receivedAt: d.receivedAt,
        hasExistingCard: d.hasExistingCard,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not compute file card cost context.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
