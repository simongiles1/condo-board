import { NextResponse } from "next/server";

import { pullMeetingSourcesFromProduction } from "@/lib/meeting-v2/pull-remote-sources";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await context.params;

  try {
    const outcome = await pullMeetingSourcesFromProduction(id);
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.result);
  } catch (error) {
    console.error("[dev:pull-sources]", error);
    return NextResponse.json(
      { error: "Could not pull meeting sources from production." },
      { status: 500 },
    );
  }
}
