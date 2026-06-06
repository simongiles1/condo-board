export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getAppBaseUrl,
  getGmailScopes,
  getOAuthRedirectUri,
} from "@/lib/gmail/oauth";

export async function GET() {
  return NextResponse.json({
    appBaseUrl: getAppBaseUrl(),
    redirectUri: getOAuthRedirectUri(),
    scopes: {
      dedicated: getGmailScopes("dedicated"),
      personal_backfill: getGmailScopes("personal_backfill"),
    },
  });
}
