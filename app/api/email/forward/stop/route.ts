export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { stopPersonalForwardWorkflow } from "@/lib/gmail/forward-workflow";

export async function POST() {
  try {
    const run = await stopPersonalForwardWorkflow();
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:forward:stop]", error);
    return NextResponse.json(
      { error: "Could not stop forwarding workflow." },
      { status: 500 },
    );
  }
}
