import { google } from "googleapis";

import { getAppBaseUrl } from "@/lib/app-url";

export type GmailAccountType = "personal_backfill" | "dedicated";

export { getAppBaseUrl };

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** @deprecated Use getGmailScopes(accountType) for account-specific scopes. */
export const GMAIL_SCOPES = [GMAIL_READONLY_SCOPE];

export function getGmailScopes(accountType: GmailAccountType): string[] {
  if (accountType === "dedicated") {
    return [GMAIL_MODIFY_SCOPE];
  }
  return [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE];
}

export function getOAuthRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    `${getAppBaseUrl()}/api/email/oauth/callback`
  );
}

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, getOAuthRedirectUri());
}

export function buildOAuthState(accountType: GmailAccountType): string {
  return Buffer.from(
    JSON.stringify({ accountType, ts: Date.now() }),
    "utf8",
  ).toString("base64url");
}

export function parseOAuthState(
  state: string,
): { accountType: GmailAccountType } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as { accountType?: GmailAccountType };

    if (
      parsed.accountType !== "personal_backfill" &&
      parsed.accountType !== "dedicated"
    ) {
      return null;
    }

    return { accountType: parsed.accountType };
  } catch {
    return null;
  }
}

export function getAuthorizationUrl(accountType: GmailAccountType): string {
  const client = getOAuth2Client();
  const options: {
    access_type: "offline";
    prompt: string;
    scope: string[];
    state: string;
    include_granted_scopes?: boolean;
    login_hint?: string;
  } = {
    access_type: "offline",
    prompt: "consent",
    scope: getGmailScopes(accountType),
    state: buildOAuthState(accountType),
    include_granted_scopes: true,
  };

  if (accountType === "dedicated") {
    const loginHint = process.env.GMAIL_DEDICATED_EMAIL?.trim();
    if (loginHint) {
      options.login_hint = loginHint;
    } else {
      // Avoid authuser/session confusion when the dedicated address is not pinned.
      options.prompt = "select_account consent";
    }
  } else {
    options.prompt = "select_account consent";
  }

  return client.generateAuthUrl(options);
}
