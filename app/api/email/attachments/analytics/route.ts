export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { loadAttachmentAnalytics } from "@/lib/email/attachment-analytics";
import {
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filters";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filters = parseEmailThreadFilters(
      searchParamsToFilterRecord(searchParams),
    );
    const filtersActive = hasActiveFilters(filters);
    const analytics = await loadAttachmentAnalytics(filters, filtersActive);
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("[email:attachments:analytics:get]", error);
    return NextResponse.json(
      { error: "Could not load attachment analytics." },
      { status: 500 },
    );
  }
}
