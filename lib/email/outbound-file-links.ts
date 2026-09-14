/**
 * Detect when an email sent files via a download link (zip, Dropbox, Drive)
 * instead of a Gmail attachment. We surface those for a human download —
 * auto-fetch hits login walls and is not in this slice.
 */

import { desc, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";

export const OUTBOUND_FILE_LINK_KINDS = ["zip", "cloud"] as const;
export type OutboundFileLinkKind = (typeof OUTBOUND_FILE_LINK_KINDS)[number];

export type OutboundFileLink = {
  url: string;
  label: string;
  kind: OutboundFileLinkKind;
};

export type OutboundFileLinkEmail = {
  emailId: string;
  threadId: string | null;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  pdfAttachmentCount: number;
  links: OutboundFileLink[];
};

const CLOUD_HOSTS = [
  "dropbox.com",
  "drive.google.com",
  "docs.google.com",
  "1drv.ms",
  "onedrive.live.com",
  "sharepoint.com",
  "buildinglink.com",
  "we.tl",
  "wetransfer.com",
  "box.com",
  "icloud.com",
];

const ARCHIVE_EXT_RE = /\.(zip|7z|rar)(?:$|[?#])/i;
const SKIP_HOST_RE =
  /\b(facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|instagram\.com)\b/i;
const HREF_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Postgres filter used to load candidate bodies; JS still classifies URLs. */
export const OUTBOUND_FILE_LINK_SQL_PATTERN =
  "dropbox\\.com|drive\\.google\\.com|docs\\.google\\.com|1drv\\.ms|onedrive\\.live\\.com|sharepoint\\.com|buildinglink\\.com|we\\.tl|wetransfer\\.com|box\\.com|icloud\\.com|\\.zip(\\?|#|$)";

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeUrl(raw: string): string | null {
  const trimmed = decodeEntities(raw.trim()).replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (SKIP_HOST_RE.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function classifyOutboundFileUrl(url: string): OutboundFileLinkKind | null {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (ARCHIVE_EXT_RE.test(url)) return "zip";
  const host = hostname.replace(/^www\./, "");
  if (CLOUD_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return "cloud";
  }
  return null;
}

export function extractOutboundFileLinks(params: {
  html?: string | null;
  text?: string | null;
}): OutboundFileLink[] {
  const seen = new Set<string>();
  const links: OutboundFileLink[] = [];

  const add = (rawUrl: string, rawLabel: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url || seen.has(url)) return;
    const kind = classifyOutboundFileUrl(url);
    if (!kind) return;
    seen.add(url);
    const label = stripTags(decodeEntities(rawLabel)).slice(0, 120) || url;
    links.push({ url, label, kind });
  };

  const html = params.html ?? "";
  if (html) {
    HREF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HREF_RE.exec(html))) {
      add(match[1] ?? "", match[2] ?? "");
    }
  }

  const text = `${params.html ?? ""}\n${params.text ?? ""}`;
  BARE_URL_RE.lastIndex = 0;
  let bare: RegExpExecArray | null;
  while ((bare = BARE_URL_RE.exec(text))) {
    add(bare[0] ?? "", bare[0] ?? "");
  }

  return links;
}

export async function listOutboundFileLinkEmails(
  limit = 80,
): Promise<OutboundFileLinkEmail[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      bodyHtml: emails.bodyHtml,
      bodyText: emails.bodyText,
      pdfAttachmentCount: sql<number>`(
        select count(*)::int
        from ${emailAttachments} a
        where a.email_id = ${emails.id}
          and (
            lower(a.mime_type) = 'application/pdf'
            or lower(a.filename) like '%.pdf'
          )
      )`,
    })
    .from(emails)
    .where(
      sql`(
        coalesce(${emails.bodyHtml}, '') ~* ${OUTBOUND_FILE_LINK_SQL_PATTERN}
        or ${emails.bodyText} ~* ${OUTBOUND_FILE_LINK_SQL_PATTERN}
      )`,
    )
    .orderBy(desc(emails.receivedAt))
    .limit(limit);

  const results: OutboundFileLinkEmail[] = [];
  for (const row of rows) {
    const links = extractOutboundFileLinks({
      html: row.bodyHtml,
      text: row.bodyText,
    });
    if (links.length === 0) continue;
    results.push({
      emailId: row.id,
      threadId: row.threadId,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      pdfAttachmentCount: Number(row.pdfAttachmentCount) || 0,
      links,
    });
  }
  return results;
}
