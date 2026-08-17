export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { loadExtractionCalendar } from "@/lib/email/extraction-calendar-load";
import {
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filters";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filters = parseEmailThreadFilters(
      searchParamsToFilterRecord(searchParams),
    );

    const payload = await loadExtractionCalendar({
      filters,
      year: searchParams.get("year"),
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[email:extraction-calendar:get]", error);
    return NextResponse.json(
      { error: "Could not load extraction calendar." },
      { status: 500 },
    );
  }
}
