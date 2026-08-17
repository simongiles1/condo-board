export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { parsePendingAttachmentBatch } from "@/lib/email/attachment-markdown";

export async function POST() {
  try {
    const result = await parsePendingAttachmentBatch();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:attachments:parse-batch:post]", error);
    const message =
      error instanceof Error ? error.message : "Could not parse attachments.";
    const missingConfig = message.includes("CLOUDFLARE_");
    return NextResponse.json(
      { error: message },
      { status: missingConfig ? 503 : 500 },
    );
  }
}
