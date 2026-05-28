export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { purgeProcessedData } from "@/lib/analysis/purge-processed-data";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { confirm?: boolean };

    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmation required." },
        { status: 400 },
      );
    }

    const result = await purgeProcessedData();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[analysis:purge-processed-data]", error);
    return NextResponse.json(
      { error: "Could not delete processed data." },
      { status: 500 },
    );
  }
}
