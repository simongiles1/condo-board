export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  resolveMentionUniqueBody,
  uniqueBodyFieldsAreStored,
} from "@/lib/contacts/mention-presence";
import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";
import { deleteEmailMessage } from "@/lib/email/delete-message";
import { formatEmailBodyForDisplay } from "@/lib/email/format-body-display";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";
import { loadHarvestMentionsForEmail } from "@/lib/organizations/mention-evidence";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();
    const [message] = await db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        subject: emails.subject,
        fromAddress: emails.fromAddress,
        toAddresses: emails.toAddresses,
        ccAddresses: emails.ccAddresses,
        receivedAt: emails.receivedAt,
        source: emails.source,
        bodyText: emails.bodyText,
        bodyHtml: emails.bodyHtml,
        bodyTextUnique: emails.bodyTextUnique,
        bodyTextStrictUnique: emails.bodyTextStrictUnique,
        processedAt: emails.processedAt,
      })
      .from(emails)
      .where(eq(emails.id, id));

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

    let liveUnique: string | null = null;
    if (!uniqueBodyFieldsAreStored(message) && message.threadId) {
      const threadMessages = await db
        .select({
          id: emails.id,
          bodyText: emails.bodyText,
          bodyHtml: emails.bodyHtml,
          receivedAt: emails.receivedAt,
        })
        .from(emails)
        .where(eq(emails.threadId, message.threadId));
      const uniqueMap = computeThreadUniqueBodies(
        threadMessages.map((row) => ({
          id: row.id,
          bodyText: row.bodyText,
          bodyHtml: row.bodyHtml,
          receivedAt: row.receivedAt,
        })),
      );
      liveUnique = uniqueMap.get(message.id) ?? null;
    }

    const resolvedUnique = resolveMentionUniqueBody(message, liveUnique);
    const { ensurePaintedOrgMentionSurfacesForEmail } = await import(
      "@/lib/organizations/mention-persist"
    );
    await ensurePaintedOrgMentionSurfacesForEmail(message.id);
    const mentions = await loadHarvestMentionsForEmail(message.id);

    return NextResponse.json({
      message: {
        id: message.id,
        subject: message.subject,
        fromAddress: message.fromAddress,
        toAddresses: JSON.parse(message.toAddresses) as string[],
        ccAddresses: JSON.parse(message.ccAddresses || "[]") as string[],
        receivedAt: message.receivedAt,
        source: message.source,
        bodyText: message.bodyText,
        bodyTextUnique: resolvedUnique,
        bodyDisplay: formatEmailBodyForDisplay(message.bodyText, message.bodyHtml),
        bodyDisplayUnique: resolvedUnique
          ? formatEmailBodyForDisplay(resolvedUnique, null)
          : null,
        processedAt: message.processedAt,
        attachments,
        mentions,
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

    revalidatePath("/knowledge/emails");
    if (result.threadId) {
      revalidatePath(`/knowledge/emails/${result.threadId}`);
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
