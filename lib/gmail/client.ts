import { eq } from "drizzle-orm";
import { google } from "googleapis";

import { getDb } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";

import {
  getOAuth2Client,
  type GmailAccountType,
} from "./oauth";
import { decryptToken, encryptToken } from "./tokens";

export async function getGmailClient(accountType: GmailAccountType) {
  const db = getDb();
  const [connection] = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.accountType, accountType));

  if (!connection) {
    throw new Error(
      `No Gmail connection for account type "${accountType}". Connect via Email Settings.`,
    );
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decryptToken(connection.encryptedAccessToken),
    refresh_token: decryptToken(connection.encryptedRefreshToken),
    expiry_date: connection.tokenExpiry
      ? new Date(connection.tokenExpiry).getTime()
      : undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    if (!tokens.access_token && !tokens.refresh_token) return;

    const updates: Partial<typeof gmailConnections.$inferInsert> = {};

    if (tokens.access_token) {
      updates.encryptedAccessToken = encryptToken(tokens.access_token);
    }
    if (tokens.refresh_token) {
      updates.encryptedRefreshToken = encryptToken(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      updates.tokenExpiry = new Date(tokens.expiry_date).toISOString();
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(gmailConnections)
        .set(updates)
        .where(eq(gmailConnections.accountType, accountType));
    }
  });

  return {
    gmail: google.gmail({
      version: "v1",
      auth: oauth2Client,
      timeout: 30_000,
    }),
    connection,
  };
}

export async function upsertGmailConnection(input: {
  accountType: GmailAccountType;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiryDate?: number | null;
  historyId?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = input.accountType;

  const row = {
    id,
    accountType: input.accountType,
    emailAddress: input.emailAddress,
    encryptedAccessToken: encryptToken(input.accessToken),
    encryptedRefreshToken: encryptToken(input.refreshToken),
    tokenExpiry: input.expiryDate
      ? new Date(input.expiryDate).toISOString()
      : null,
    connectedAt: now,
    lastSyncAt: null,
    lastHistoryId: input.historyId ?? null,
  };

  await db
    .insert(gmailConnections)
    .values(row)
    .onConflictDoUpdate({
      target: gmailConnections.accountType,
      set: {
        emailAddress: row.emailAddress,
        encryptedAccessToken: row.encryptedAccessToken,
        encryptedRefreshToken: row.encryptedRefreshToken,
        tokenExpiry: row.tokenExpiry,
        connectedAt: row.connectedAt,
        lastHistoryId: input.historyId ?? null,
        lastSyncAt: null,
      },
    });
}
