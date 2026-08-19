export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { AnalyzeEmailButton } from "@/components/AnalyzeEmailButton";
import { EmailThreadView } from "@/components/EmailThreadView";
import { resolveMentionUniqueBody } from "@/lib/contacts/mention-presence";
import { getDb } from "@/lib/db";
import { emailAttachments, emails, emailThreads } from "@/lib/db/schema";
import { formatEmailBodyForDisplay } from "@/lib/email/format-body-display";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";
import {
  EMAIL_MESSAGE_SCOPE,
  emailDetailBackHref,
  parseEmailDetailScope,
} from "@/lib/email/thread-filters";
import { formatDateTime } from "@/lib/format/datetime";

async function loadMessageWithAttachments(
  message: typeof emails.$inferSelect,
  bodyTextUnique?: string | null,
) {
  const db = getDb();
  const attachments = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.emailId, message.id));

  const uniqueText = resolveMentionUniqueBody(
    {
      bodyText: message.bodyText,
      bodyTextUnique: message.bodyTextUnique,
      bodyTextStrictUnique: message.bodyTextStrictUnique,
    },
    bodyTextUnique,
  );

  return {
    id: message.id,
    subject: message.subject,
    fromAddress: message.fromAddress,
    toAddresses: JSON.parse(message.toAddresses) as string[],
    ccAddresses: JSON.parse(message.ccAddresses || "[]") as string[],
    receivedAt: message.receivedAt,
    source: message.source,
    bodyText: message.bodyText,
    bodyTextUnique: uniqueText,
    bodyDisplay: formatEmailBodyForDisplay(message.bodyText, message.bodyHtml),
    bodyDisplayUnique: uniqueText
      ? formatEmailBodyForDisplay(uniqueText, null)
      : null,
    processedAt: message.processedAt,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      hasValue: attachment.hasValue,
    })),
  };
}

function uniqueBodiesForMessages(messages: (typeof emails.$inferSelect)[]) {
  return computeThreadUniqueBodies(
    messages.map((message) => ({
      id: message.id,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      receivedAt: message.receivedAt,
    })),
  );
}

export default async function EmailThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const scope = parseEmailDetailScope(rawSearchParams);
  const backHref = emailDetailBackHref(rawSearchParams);
  const db = getDb();

  if (scope === EMAIL_MESSAGE_SCOPE) {
    const [message] = await db.select().from(emails).where(eq(emails.id, id));
    if (!message) notFound();

    const threadSiblings = message.threadId
      ? await db
          .select()
          .from(emails)
          .where(eq(emails.threadId, message.threadId))
      : [message];
    const uniqueMap = uniqueBodiesForMessages(threadSiblings);
    const messageWithAttachments = await loadMessageWithAttachments(
      message,
      uniqueMap.get(message.id),
    );
    const thread = message.threadId
      ? (
          await db
            .select()
            .from(emailThreads)
            .where(eq(emailThreads.id, message.threadId))
        )[0]
      : null;

    return (
      <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div>
          <Link href={backHref} className="text-sm text-teal-700 hover:underline">
            ← Back to inbox
          </Link>
          <div className="mt-2 flex w-full items-start justify-between gap-4">
            <h1 className="min-w-0 text-2xl font-semibold text-slate-900">
              {message.subject}
            </h1>
          </div>
          {thread ? (
            <p className="mt-1 text-sm text-slate-600">
              Part of thread &ldquo;{thread.subject}&rdquo;
            </p>
          ) : null}
          <p className="mt-1 text-sm text-slate-600">
            Received {formatDateTime(message.receivedAt)}
          </p>
        </div>

        <AnalyzeEmailButton
          mode="message"
          emailId={messageWithAttachments.id}
          processedAt={messageWithAttachments.processedAt}
        />

        <EmailThreadView messages={[messageWithAttachments]} />
      </section>
    );
  }

  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, id));

  if (!thread) notFound();

  const messages = await db
    .select()
    .from(emails)
    .where(eq(emails.threadId, id))
    .orderBy(desc(emails.receivedAt));

  const uniqueMap = uniqueBodiesForMessages(messages);
  const messagesWithAttachments = await Promise.all(
    messages.map((message) =>
      loadMessageWithAttachments(message, uniqueMap.get(message.id)),
    ),
  );

  const processedCount = messagesWithAttachments.filter(
    (message) => message.processedAt,
  ).length;

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div>
        <Link href={backHref} className="text-sm text-teal-700 hover:underline">
          ← Back to inbox
        </Link>
        <div className="mt-2 flex w-full items-start justify-between gap-4">
          <h1 className="min-w-0 text-2xl font-semibold text-slate-900">
            {thread.subject}
          </h1>
          <div className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Email count:</span>
            <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200">
              {messages.length}
            </span>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Last activity {formatDateTime(thread.lastMessageAt)}
        </p>
      </div>

      {messagesWithAttachments.length > 0 ? (
        <AnalyzeEmailButton
          mode="thread"
          emailIds={messagesWithAttachments.map((message) => message.id)}
          processedCount={processedCount}
          totalCount={messagesWithAttachments.length}
        />
      ) : null}

      <EmailThreadView messages={messagesWithAttachments} />
    </section>
  );
}
