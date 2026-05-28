import type { gmail_v1 } from "googleapis";

export type ParsedEmailMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  receivedAt: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
    gmailAttachmentId: string | null;
  }>;
};

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | null {
  const match = headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? null;
}

function firstMailboxEmail(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim();
  if (trimmed.includes("@")) return trimmed;
  return trimmed;
}

function extractAddresses(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const angle = part.match(/<([^>]+)>/);
      return (angle?.[1] ?? part).trim();
    })
    .filter(Boolean);
}

function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: { text: string; html: string | null },
  attachments: ParsedEmailMessage["attachments"],
) {
  if (!part) return;

  const mimeType = part.mimeType ?? "";
  const bodyData = part.body?.data;

  if (bodyData && mimeType === "text/plain") {
    acc.text += decodeBase64Url(bodyData);
  } else if (bodyData && mimeType === "text/html") {
    acc.html = (acc.html ?? "") + decodeBase64Url(bodyData);
  } else if (part.filename && part.body?.attachmentId) {
    attachments.push({
      filename: part.filename,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: part.body.size ?? null,
      gmailAttachmentId: part.body.attachmentId,
    });
  }

  for (const child of part.parts ?? []) {
    walkParts(child, acc, attachments);
  }
}

export function parseGmailMessage(
  message: gmail_v1.Schema$Message,
): ParsedEmailMessage | null {
  if (!message.id || !message.threadId) return null;

  const headers = message.payload?.headers;
  const fromHeader = getHeader(headers, "From");
  const fromAddress = firstMailboxEmail(fromHeader) ?? "unknown@unknown";
  const toAddresses = extractAddresses(getHeader(headers, "To"));
  const ccAddresses = extractAddresses(getHeader(headers, "Cc"));
  const subject = getHeader(headers, "Subject") ?? "(no subject)";
  const messageIdHeader = getHeader(headers, "Message-ID");
  const inReplyTo = getHeader(headers, "In-Reply-To");
  const referencesHeader = getHeader(headers, "References");

  const bodyAcc = { text: "", html: null as string | null };
  const attachments: ParsedEmailMessage["attachments"] = [];
  walkParts(message.payload, bodyAcc, attachments);

  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    messageIdHeader,
    inReplyTo,
    referencesHeader,
    fromAddress,
    toAddresses,
    ccAddresses,
    subject,
    bodyText: bodyAcc.text.trim() || bodyAcc.html?.replace(/<[^>]+>/g, " ").trim() || "",
    bodyHtml: bodyAcc.html,
    receivedAt,
    attachments,
  };
}
