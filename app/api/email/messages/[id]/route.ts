export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";
import { deleteEmailMessage } from "@/lib/email/delete-message";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();
    const [message] = await db.select().from(emails).where(eq(emails.id, id));

    if (!message) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }

    const attachments = await db
      .select({
        id: emailAttachments.id,
        filename: emailAttachments.filename,
        mimeType: emailAttachments.mimeType,
        sizeBytes: emailAttachments.sizeBytes,
        hasValue: emailAttachments.hasValue,
      })
      .from(emailAttachments)
      .where(eq(emailAttachments.emailId, message.id));

    return NextResponse.json({
      message: {
        id: message.id,
        subject: message.subject,
        fromAddress: message.fromAddress,
        toAddresses: JSON.parse(message.toAddresses) as string[],
        receivedAt: message.receivedAt,
        source: message.source,
        bodyText: message.bodyText,
        processedAt: message.processedAt,
        attachments,
      },
    });
  } catch (error) {
    console.error("[email:messages:get]", error);
    return NextResponse.json(
      { error: "Could not load email." },
      { status: 500 },
    );
  }
}

type DeleteBody = {
  deleteFromDb?: boolean;
  deleteFromGmail?: boolean;
};

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: DeleteBody = {};
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const deleteFromDb = body.deleteFromDb === true;
  const deleteFromGmail = body.deleteFromGmail === true;

  if (!deleteFromDb && !deleteFromGmail) {
    return NextResponse.json(
      { error: "Choose at least one delete target." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteEmailMessage(id, {
      deleteFromDb,
      deleteFromGmail,
    });

    revalidatePath("/emails");
    if (result.threadId) {
      revalidatePath(`/emails/${result.threadId}`);
    }

    const status = result.errors.length > 0 ? 207 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete email.";

    if (message === "Email not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (
      message.startsWith("Only messages synced") ||
      message.startsWith("Choose at least one")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[email:messages:delete]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
