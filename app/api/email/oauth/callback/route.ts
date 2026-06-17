export const runtime = "nodejs";

import { google } from "googleapis";
import { NextResponse } from "next/server";

import { upsertGmailConnection } from "@/lib/gmail/client";
import { getExpectedDedicatedEmail } from "@/lib/gmail/verify";
import {
  getAppBaseUrl,
  getOAuth2Client,
  parseOAuthState,
} from "@/lib/gmail/oauth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  console.info("[email:oauth:callback] received", {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    oauthError,
  });

  const settingsUrl = new URL("/settings", getAppBaseUrl());

  if (oauthError) {
    settingsUrl.searchParams.set("error", oauthError);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("error", "missing_code_or_state");
    return NextResponse.redirect(settingsUrl);
  }

  const parsedState = parseOAuthState(state);
  if (!parsedState) {
    settingsUrl.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      settingsUrl.searchParams.set("error", "missing_tokens");
      return NextResponse.redirect(settingsUrl);
    }

    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const emailAddress = profile.data.emailAddress;

    if (!emailAddress) {
      settingsUrl.searchParams.set("error", "missing_email");
      return NextResponse.redirect(settingsUrl);
    }

    const expectedDedicated = getExpectedDedicatedEmail();
    if (
      parsedState.accountType === "dedicated" &&
      expectedDedicated &&
      emailAddress.toLowerCase() !== expectedDedicated
    ) {
      settingsUrl.searchParams.set(
        "error",
        `Wrong Google account: signed in as ${emailAddress}. Use ${expectedDedicated} for the dedicated condo mailbox.`,
      );
      return NextResponse.redirect(settingsUrl);
    }

    await upsertGmailConnection({
      accountType: parsedState.accountType,
      emailAddress,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      historyId: profile.data.historyId ?? null,
    });

    settingsUrl.searchParams.set("connected", parsedState.accountType);
    return NextResponse.redirect(settingsUrl);
  } catch (error) {
    console.error("[email:oauth:callback]", error);
    settingsUrl.searchParams.set(
      "error",
      error instanceof Error ? error.message : "oauth_failed",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
