export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getAnalysisActorUserId } from "@/lib/auth/analysis-actor";
import { getCostSummary } from "@/lib/email-analysis/cost-summary";
import { analyzeAllUnprocessed } from "@/lib/email-analysis/worker";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      confirm?: boolean;
      reprocess?: boolean;
    };

    if (!body.confirm) {
      const summary = await getCostSummary();
      return NextResponse.json(
        {
          error: "Confirmation required.",
          extrapolation: summary.extrapolation,
          unprocessedEmailCount: summary.unprocessedEmailCount,
        },
        { status: 400 },
      );
    }

    const triggeredByUserId = await getAnalysisActorUserId();

    const results = await analyzeAllUnprocessed({
      reprocess: body.reprocess ?? false,
      triggeredByUserId,
    });

    return NextResponse.json({
      processedCount: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
