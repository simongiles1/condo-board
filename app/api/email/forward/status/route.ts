export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getForwardRunStatus } from "@/lib/gmail/forward-workflow";
import { getForwardSchedulerStatus } from "@/lib/gmail/forward-scheduler";

export async function GET() {
  try {
    const status = await getForwardRunStatus();
    return NextResponse.json({
      run: status,
      scheduler: getForwardSchedulerStatus(),
    });
  } catch (error) {
    console.error("[email:forward:status]", error);
    return NextResponse.json(
      { error: "Could not load forward workflow status." },
      { status: 500 },
    );
  }
}
