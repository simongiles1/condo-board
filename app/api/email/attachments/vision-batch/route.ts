export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { processPendingVisionBatch } from "@/lib/email/page-vision";

export async function POST(request: Request) {
  try {
    let contentHash: string | undefined;
    let batchSize: number | undefined;
    try {
      const body = (await request.json()) as {
        contentHash?: string;
        batchSize?: number;
      };
      if (typeof body.contentHash === "string" && body.contentHash.trim()) {
        contentHash = body.contentHash.trim();
      }
      if (
        typeof body.batchSize === "number" &&
        Number.isFinite(body.batchSize)
      ) {
        batchSize = Math.floor(body.batchSize);
      }
    } catch {
      // empty body is fine
    }

    const result = await processPendingVisionBatch({
      contentHash,
      batchSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:attachments:vision-batch:post]", error);
    const message =
      error instanceof Error ? error.message : "Could not run page vision.";
    const missingConfig = message.includes("GEMINI_API_KEY");
    return NextResponse.json(
      { error: message },
      { status: missingConfig ? 503 : 500 },
    );
  }
}
