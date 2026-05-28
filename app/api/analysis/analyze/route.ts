export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { analyzeEmail } from "@/lib/email-analysis/worker";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      emailId?: string;
      reprocess?: boolean;
    };

    if (!body.emailId?.trim()) {
      return NextResponse.json(
        { error: "emailId is required." },
        { status: 400 },
      );
    }

    const result = await analyzeEmail({
      emailId: body.emailId.trim(),
      reprocess: body.reprocess ?? false,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
