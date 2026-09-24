export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import {
  binEmailsByTime,
  binEmailsByTimeMulti,
  messageMatchesTimelineSender,
  type TimelineBin,
  type TimelineBinSize,
  type TimelineMultiBin,
} from "@/lib/email/timeline-bins";
import {
  chartSeriesForTimelineSenderIds,
  EMAIL_TIMELINE_SENDER_OPTIONS,
} from "@/lib/email/timeline-senders";
import {
  buildThreadFilterWhere,
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filters";

function parseBinSize(value: string | null): TimelineBinSize {
  if (
    value === "month" ||
    value === "week" ||
    value === "month_avg_2" ||
    value === "month_avg_3"
  ) {
    return value;
  }
  return "week";
}

function resolveTimelineSenderSeries(fromAddresses: string[]) {
  const normalized = fromAddresses.map((address) => address.toLowerCase());
  return EMAIL_TIMELINE_SENDER_OPTIONS.filter((option) =>
    normalized.includes(option.email.toLowerCase()),
  );
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
    const query = db
      .select({
        receivedAt: emails.receivedAt,
        fromAddress: emails.fromAddress,
        ccAddresses: emails.ccAddresses,
      })
      .from(emails);
    const rows = filterWhere ? await query.where(filterWhere) : await query;

    const fromAddresses = filters.fromAddresses ?? [];
    const senderSeries = resolveTimelineSenderSeries(fromAddresses);
    const multiSeries = senderSeries.length > 1;

    let bins: TimelineBin[] | TimelineMultiBin[];
    if (multiSeries) {
      const messages = rows.map((row) => ({
        receivedAt: row.receivedAt,
        senderIds: senderSeries
          .filter((series) =>
            messageMatchesTimelineSender(
              row.fromAddress,
              row.ccAddresses,
              series.email,
            ),
          )
          .map((series) => series.id),
      }));
      bins = binEmailsByTimeMulti(messages, binSize);
    } else {
      bins = binEmailsByTime(
        rows.map((row) => row.receivedAt),
        binSize,
      );
    }

    return NextResponse.json({
      bins,
      totalCount: rows.length,
      binSize,
      filtersActive: hasActiveFilters(filters),
      series: multiSeries
        ? chartSeriesForTimelineSenderIds(senderSeries.map((entry) => entry.id))
        : undefined,
    });
  } catch (error) {
    console.error("[email:timeline:get]", error);
    return NextResponse.json(
      { error: "Could not load email timeline." },
      { status: 500 },
    );
  }
}
