export const runtime = "nodejs";

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { emailAttachments, emails, emailThreads } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, id));

    if (!thread) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const messages = await db
      .select()
      .from(emails)
      .where(eq(emails.threadId, id))
      .orderBy(desc(emails.receivedAt));

    const messagesWithAttachments = await Promise.all(
      messages.map(async (message) => {
        const attachments = await db
          .select()
          .from(emailAttachments)
          .where(eq(emailAttachments.emailId, message.id));

        return {
          ...message,
          toAddresses: JSON.parse(message.toAddresses) as string[],
          attachments,
        };
      }),
    );

    return NextResponse.json({
      thread,
      messages: messagesWithAttachments,
    });
  } catch (error) {
    console.error("[email:threads:get:id]", error);
    return NextResponse.json(
      { error: "Could not load email thread." },
      { status: 500 },
    );
  }
}
