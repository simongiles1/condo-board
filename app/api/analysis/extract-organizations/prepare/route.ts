export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  isErrorResponse,
  requireSession,
} from "@/lib/auth/authorize";
import {
  prepareOrgExtractItemsForEmails,
  prepareOrgExtractItemsForThread,
} from "@/lib/email-analysis/org-highlight-prepare";

function parseEmailIdsParam(value: string | null): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId")?.trim() || "";
  const emailIds = parseEmailIdsParam(searchParams.get("emailIds"));

  if (!threadId && emailIds.length === 0) {
    return NextResponse.json(
      { error: "threadId or emailIds is required." },
      { status: 400 },
    );
  }

  try {
    const items = threadId
      ? await prepareOrgExtractItemsForThread(threadId)
      : await prepareOrgExtractItemsForEmails(emailIds);

    return NextResponse.json({ items });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not prepare organization extraction items.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
