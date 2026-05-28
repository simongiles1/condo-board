export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import {
  binEmailsByTime,
  type TimelineBinSize,
} from "@/lib/email/timeline-bins";
import {
  buildThreadFilterWhere,
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filters";

function parseBinSize(value: string | null): TimelineBinSize {
  return value === "month" ? "month" : "week";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const binSize = parseBinSize(searchParams.get("bin"));
    const filters = parseEmailThreadFilters(
      searchParamsToFilterRecord(searchParams),
    );
    const filterWhere = buildThreadFilterWhere(filters);

    const db = getDb();
    const query = db.select({ receivedAt: emails.receivedAt }).from(emails);
    const rows = filterWhere ? await query.where(filterWhere) : await query;

    const bins = binEmailsByTime(
      rows.map((row) => row.receivedAt),
      binSize,
    );

    return NextResponse.json({
      bins,
      totalCount: rows.length,
      binSize,
      filtersActive: hasActiveFilters(filters),
    });
  } catch (error) {
    console.error("[email:timeline:get]", error);
    return NextResponse.json(
      { error: "Could not load email timeline." },
      { status: 500 },
    );
  }
}
