export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  fetchExtractionAuditForEmail,
  fetchExtractionAuditForThread,
} from "@/lib/email/extraction-audit";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get("emailId");
  const threadId = searchParams.get("threadId");

  if (emailId && threadId) {
    return NextResponse.json(
      { error: "Provide only emailId or threadId." },
      { status: 400 },
    );
  }

  if (!emailId && !threadId) {
    return NextResponse.json(
      { error: "emailId or threadId is required." },
      { status: 400 },
    );
  }

  try {
    if (emailId) {
      const data = await fetchExtractionAuditForEmail(emailId);
      return NextResponse.json({ kind: "email", emailId, ...data });
    }

    const data = await fetchExtractionAuditForThread(threadId!);
    return NextResponse.json({ kind: "thread", threadId, ...data });
  } catch (error) {
    console.error("[email:extractions:get]", error);
    return NextResponse.json(
      { error: "Could not load extractions." },
      { status: 500 },
    );
  }
}
