export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getAttachmentParseStatus } from "@/lib/email/attachment-markdown";

export async function GET() {
  try {
    const status = await getAttachmentParseStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[email:attachments:parse-status:get]", error);
    return NextResponse.json(
      { error: "Could not load attachment parse status." },
      { status: 500 },
    );
  }
}
