/** Mechanical quote stripping — not semantic extraction. */

const QUOTE_PATTERNS: RegExp[] = [
  /^On .+ wrote:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^From:.+\nSent:.+\nTo:.+\nSubject:.+\s*$/im,
  /^_{10,}\s*$/m,
];

export function stripQuotedReplyLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  let inQuoteBlock = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (/^>/.test(trimmed)) {
      inQuoteBlock = true;
      continue;
    }

    if (QUOTE_PATTERNS.some((pattern) => pattern.test(line))) {
      inQuoteBlock = true;
      continue;
    }

    if (inQuoteBlock && trimmed === "") {
      continue;
    }

    if (inQuoteBlock && !trimmed.startsWith(">") && trimmed.length > 0) {
      const looksLikeNewContent =
        !/^On .+ wrote:/i.test(trimmed) &&
        !/^From:/i.test(trimmed) &&
        !/^Sent:/i.test(trimmed);
      if (looksLikeNewContent) {
        inQuoteBlock = false;
      } else {
        continue;
      }
    }

    if (!inQuoteBlock) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

export function stripHtmlQuotes(html: string | null | undefined): string {
  if (!html?.trim()) return "";
  let text = html;
  text = text.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");
  text = text.replace(/<div class="gmail_quote"[\s\S]*?<\/div>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return stripQuotedReplyLines(text);
}

export function computeUniqueBodyText(
  bodyText: string,
  bodyHtml?: string | null,
): string {
  const fromPlain = stripQuotedReplyLines(bodyText);
  if (fromPlain.trim()) return fromPlain;
  return stripHtmlQuotes(bodyHtml);
}
