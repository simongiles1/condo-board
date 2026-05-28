export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getAuthorizationUrl,
  type GmailAccountType,
} from "@/lib/gmail/oauth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountType = searchParams.get("accountType");

  if (
    accountType !== "personal_backfill" &&
    accountType !== "dedicated"
  ) {
    return NextResponse.json(
      { error: "accountType must be personal_backfill or dedicated." },
      { status: 400 },
    );
  }

  try {
    const url = getAuthorizationUrl(accountType as GmailAccountType);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[email:oauth:start]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start Gmail OAuth.",
      },
      { status: 500 },
    );
  }
}
