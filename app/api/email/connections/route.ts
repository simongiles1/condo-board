export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getSchedulerStatus } from "@/lib/email/scheduler";
import { getDb } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import {
  getExpectedDedicatedEmail,
  verifyGmailConnection,
} from "@/lib/gmail/verify";

export async function GET() {
  try {
    const db = getDb();
    const connections = await db.select().from(gmailConnections);
    const scheduler = getSchedulerStatus();
    const expectedDedicatedEmail = getExpectedDedicatedEmail();

    const enrichedConnections = await Promise.all(
      connections.map(async (connection) => {
        try {
          const verification = await verifyGmailConnection(connection.accountType);
          return {
            accountType: connection.accountType,
            emailAddress: connection.emailAddress,
            verifiedEmailAddress: verification.verifiedEmailAddress,
            connectionMismatch:
              !verification.matchesStored || !verification.matchesExpectedDedicated,
            messagesTotal: verification.messagesTotal,
            lastSyncAt: connection.lastSyncAt,
            lastHistoryId: connection.lastHistoryId,
            connectedAt: connection.connectedAt,
          };
        } catch (error) {
          console.error("[email:connections:verify]", error);
          return {
            accountType: connection.accountType,
            emailAddress: connection.emailAddress,
            verifiedEmailAddress: null,
            connectionMismatch: true,
            messagesTotal: null,
            lastSyncAt: connection.lastSyncAt,
            lastHistoryId: connection.lastHistoryId,
            connectedAt: connection.connectedAt,
          };
        }
      }),
    );

    return NextResponse.json({
      connections: enrichedConnections,
      expectedDedicatedEmail,
      scheduler,
    });
  } catch (error) {
    console.error("[email:connections:get]", error);
    return NextResponse.json(
      { error: "Could not load Gmail connections." },
      { status: 500 },
    );
  }
}
