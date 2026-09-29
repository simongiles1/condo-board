import { NextResponse } from "next/server";

import {
  buildMeetingQuoteLedger,
  listMeetingQuoteRows,
  QuoteLedgerError,
} from "@/lib/meeting-v3/quote-ledger-run";

export const maxDuration = 300;

/**
 * Returns the quote rows already stored for this meeting.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await listMeetingQuoteRows(id);
    return NextResponse.json({ meetingId: id, rowCount: rows.length, rows });
  } catch {
    return NextResponse.json({ error: "Failed to load the quote ledger." }, { status: 500 });
  }
}

/**
 * Reads each agenda page and replaces the stored quote ledger.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await buildMeetingQuoteLedger(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof QuoteLedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Quote ledger failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
