export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { analyzeEmailBatch } from "@/lib/email-analysis/worker";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      emailIds?: string[];
      reprocess?: boolean;
    };

    if (!body.emailIds?.length) {
      return NextResponse.json(
        { error: "emailIds array is required." },
        { status: 400 },
      );
    }

    if (body.emailIds.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 emails per batch." },
        { status: 400 },
      );
    }

    const results = await analyzeEmailBatch({
      emailIds: body.emailIds,
      reprocess: body.reprocess ?? false,
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
