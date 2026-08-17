export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  previewPurgeAllowlistSender,
  purgeAllowlistSenderImported,
} from "@/lib/email/purge-allowlist-sender";

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email");
  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  try {
    const preview = await previewPurgeAllowlistSender(email);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[email:allowlist:purge-imported:get]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not preview imported mail for this sender.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: {
    email?: string;
    confirm?: boolean;
    removeFromAllowlist?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!body.confirm) {
    return NextResponse.json(
      { error: "Confirmation required." },
      { status: 400 },
    );
  }

  try {
    const result = await purgeAllowlistSenderImported({
      email: body.email,
      removeFromAllowlist: body.removeFromAllowlist !== false,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[email:allowlist:purge-imported:post]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete imported mail for this sender.",
      },
      { status: 500 },
    );
  }
}
