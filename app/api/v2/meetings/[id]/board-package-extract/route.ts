import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetingsV2DocumentPages } from "@/lib/db/schema-v2";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const pages = await db
      .select({
        pageNumber: meetingsV2DocumentPages.pageNumber,
        pageHeading: meetingsV2DocumentPages.pageHeading,
        extractedText: meetingsV2DocumentPages.extractedText,
      })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, id))
      .orderBy(asc(meetingsV2DocumentPages.pageNumber));

    return NextResponse.json({
      pageCount: pages.length,
      pages,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load board package extraction" },
      { status: 500 },
    );
  }
}
