export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { downloadUncachedAttachmentBatch } from "@/lib/email/attachment-download";

export async function POST() {
  try {
    const result = await downloadUncachedAttachmentBatch();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:attachments:download-batch:post]", error);
    return NextResponse.json(
      { error: "Could not download attachments." },
      { status: 500 },
    );
  }
}
