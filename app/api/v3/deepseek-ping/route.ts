import { NextResponse } from "next/server";

import { pingDeepSeekCompletion } from "@/lib/deepseek/client";

/**
 * Runs a one-line DeepSeek completion on the model fact resolution uses.
 * The body says whether any text came back, and which model ids the account can see.
 */
export async function POST() {
  try {
    const result = await pingDeepSeekCompletion();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "DeepSeek test failed.";
    return NextResponse.json({ ok: false, summary: detail }, { status: 500 });
  }
}
