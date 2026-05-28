import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";

import { getGmailClient } from "./client";
import type { GmailAccountType } from "./oauth";

const ATTACHMENT_CACHE_DIR = path.join(
  process.cwd(),
  "data",
  "email-attachments",
);

function extensionFromFilename(filename: string, mimeType: string): string {
  const ext = path.extname(filename);
  if (ext) return ext.toLowerCase();
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return ".xlsx";
  if (mimeType.includes("word")) return ".docx";
  return ".bin";
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

export function hashAttachmentBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function attachmentCachePath(contentHash: string, ext: string): string {
  return path.join(ATTACHMENT_CACHE_DIR, `${contentHash}${ext}`);
}

export async function ensureAttachmentCacheDir(): Promise<void> {
  await mkdir(ATTACHMENT_CACHE_DIR, { recursive: true });
}

export async function readCachedAttachment(
  contentHash: string,
  ext: string,
): Promise<Buffer | null> {
  try {
    return await readFile(attachmentCachePath(contentHash, ext));
  } catch {
    return null;
  }
}

export async function getEmailAttachmentContent(attachmentId: string): Promise<{
  bytes: Buffer;
  filename: string;
  mimeType: string;
}> {
  const db = getDb();
  const [attachment] = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.id, attachmentId));

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  if (attachment.contentHash && attachment.cachedFilePath) {
    const ext = attachment.cachedFilePath.match(/\.[^.]+$/)?.[0] ?? ".bin";
    const cached = await readCachedAttachment(attachment.contentHash, ext);
    if (cached) {
      return {
        bytes: cached,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      };
    }
  }

  const downloaded = await downloadEmailAttachment({
    attachmentId: attachment.id,
    emailId: attachment.emailId,
  });

  return {
    bytes: downloaded.bytes,
    filename: downloaded.filename,
    mimeType: downloaded.mimeType,
  };
}

export async function downloadEmailAttachment(input: {
  attachmentId: string;
  emailId: string;
}): Promise<{
  bytes: Buffer;
  contentHash: string;
  cachedPath: string;
  filename: string;
  mimeType: string;
}> {
  const db = getDb();
  const [attachment] = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.id, input.attachmentId));

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  if (!attachment.gmailAttachmentId) {
    throw new Error("Attachment has no Gmail attachment ID.");
  }

  const [email] = await db
    .select()
    .from(emails)
    .where(eq(emails.id, attachment.emailId));

  if (!email) {
    throw new Error("Email not found for attachment.");
  }

  const accountType: GmailAccountType = email.source;
  const { gmail } = await getGmailClient(accountType);

  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: email.gmailMessageId,
    id: attachment.gmailAttachmentId,
  });

  const data = response.data.data;
  if (!data) {
    throw new Error("Gmail returned empty attachment data.");
  }

  const bytes = decodeBase64Url(data);
  const contentHash = hashAttachmentBytes(bytes);
  const ext = extensionFromFilename(attachment.filename, attachment.mimeType);
  const cachedPath = attachmentCachePath(contentHash, ext);

  await ensureAttachmentCacheDir();

  const existing = await readCachedAttachment(contentHash, ext);
  if (!existing) {
    await writeFile(cachedPath, bytes);
  }

  await db
    .update(emailAttachments)
    .set({
      contentHash,
      cachedFilePath: cachedPath,
    })
    .where(eq(emailAttachments.id, input.attachmentId));

  return {
    bytes,
    contentHash,
    cachedPath,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
  };
}
