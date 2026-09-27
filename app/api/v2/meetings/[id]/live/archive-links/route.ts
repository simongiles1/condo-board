export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import { meetingsV2AgendaItems } from "@/lib/db/schema";
import { loadCategorizedFiles } from "@/lib/email/load-categorized-files";
import { archiveLinksForLeaves } from "@/lib/meeting-v2/live-archive-links";

/**
 * Categorized minutes and financial-statement files named by this meeting's agenda titles.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const db = getDb();
    const items = await db
      .select({
        id: meetingsV2AgendaItems.id,
        title: meetingsV2AgendaItems.title,
      })
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, id));
    const categorized = await loadCategorizedFiles();
    const links = archiveLinksForLeaves(items, {
      minutes: categorized["meeting-minutes"],
      financials: categorized["financial-statements"],
    });
    return NextResponse.json({ links });
  } catch (error) {
    console.error("[meetings:v2:live:archive-links]", error);
    return NextResponse.json(
      { error: "Could not match minutes and financial statements." },
      { status: 500 },
    );
  }
}
