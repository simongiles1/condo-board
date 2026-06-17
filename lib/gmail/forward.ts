import type { gmail_v1 } from "googleapis";

import { parseGmailMessage } from "./messages";

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) {
    return subject;
  }
  const encoded = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildForwardMessageId(gmailMessageId: string): string {
  return `<fwd.${gmailMessageId}@condo-board-forward>`;
}

export type ForwardGmailMessageResult = {
  gmailThreadId: string;
  forwardMessageIdHeader: string;
};

/** Send a simplified forward of a personal Gmail message to the dedicated mailbox. */
export async function forwardGmailMessageTo(
  gmail: gmail_v1.Gmail,
  messageId: string,
  forwardTo: string,
  options?: {
    threading?: { inReplyTo: string; references: string } | null;
  },
): Promise<ForwardGmailMessageResult> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const parsed = parseGmailMessage(response.data);
  if (!parsed) {
    throw new Error("Could not parse message for forwarding.");
  }

  const date = new Date(parsed.receivedAt).toLocaleString();
  const forwardBody = [
    "---------- Forwarded message ---------",
    `From: ${parsed.fromAddress}`,
    `Date: ${date}`,
    `Subject: ${parsed.subject}`,
    parsed.toAddresses.length > 0
      ? `To: ${parsed.toAddresses.join(", ")}`
      : null,
    parsed.ccAddresses.length > 0
      ? `Cc: ${parsed.ccAddresses.join(", ")}`
      : null,
    "",
    parsed.bodyText,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const subject = parsed.subject.toLowerCase().startsWith("fwd:")
    ? parsed.subject
    : `Fwd: ${parsed.subject}`;

  const forwardMessageIdHeader = buildForwardMessageId(parsed.gmailMessageId);
  const mimeHeaders = [
    `To: ${forwardTo}`,
    `Subject: ${encodeSubject(subject)}`,
    `Message-ID: ${forwardMessageIdHeader}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];

  if (options?.threading) {
    mimeHeaders.push(`In-Reply-To: ${options.threading.inReplyTo}`);
    mimeHeaders.push(`References: ${options.threading.references}`);
  }

  const mime = [...mimeHeaders, "", forwardBody].join("\r\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: toBase64Url(mime),
    },
  });

  return {
    gmailThreadId: parsed.gmailThreadId,
    forwardMessageIdHeader,
  };
}
