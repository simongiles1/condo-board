export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  PASSWORD_RESET_SENT_MESSAGE,
  requestPasswordReset,
} from "@/lib/auth/password-reset";

export async function POST(req: Request) {
  let body: { email?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const result = await requestPasswordReset(body.email ?? "");
  if ("error" in result) {
    const status = result.error === "Email is required." ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    message: PASSWORD_RESET_SENT_MESSAGE,
    devResetUrl: result.devResetUrl,
  });
}
