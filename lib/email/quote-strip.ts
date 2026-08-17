/**
 * Mechanical reply-quote stripping — not semantic extraction.
 *
 * Keeps forwarded content from other chains ("Forwarded message", Outlook
 * forward headers). Same-thread reply history is removed via attribution
 * markers / gmail_quote, then refined by thread-unique-content diff.
 */

import {
  collapseEmailPlainWhitespace,
  looksLikeEmailCssLeak,
  scrubEmailCssLeak,
  unwrapSoftLineBreaks,
} from "@/lib/email/format-body-display";

/** Reply attribution — everything after this is quoted prior-thread content. */
const REPLY_CUTOFF_PATTERNS: RegExp[] = [
  /^On .+ wrote:\s*$/i,
  /^Le .+ a[ée]crit\s*:\s*$/i,
];

/** Join soft-wrapped "On … wrote:" / "Le … a écrit :" attribution lines. */
function joinBrokenReplyAttributions(text: string): string {
  return text
    .replace(/^(On .+)\n(<[^>\n]+>\s*wrote:)\s*$/gim, "$1 $2")
    .replace(/^(On .+)\n(wrote:)\s*$/gim, "$1 $2")
    .replace(/^(Le .+)\n(a[ée]crit\s*:)\s*$/gim, "$1 $2");
}

export function stripQuotedReplyLines(text: string): string {
  // Soft-wrapped plain parts often break "On … wrote:" across lines — unwrap first.
  const lines = joinBrokenReplyAttributions(unwrapSoftLineBreaks(text))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (REPLY_CUTOFF_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      break;
    }

    // Drop inline quote lines; do not treat them as a hard cutoff so content
    // above an attribution line is preserved when markers are interleaved.
    if (/^>/.test(line.trimStart())) {
      continue;
    }

    result.push(line);
  }

  return result.join("\n").trim();
}

export function stripHtmlQuotes(html: string | null | undefined): string {
  if (!html?.trim()) return "";
  let text = html;
  text = text
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // Reply UI containers only — Gmail puts forwards in the main body, not here.
  text = text.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");
  text = text.replace(
    /<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/gi,
    "",
  );
  // Turn block boundaries into newlines before nuking tags so MJML/table
  // layouts don't leave dozens of indent-only blank lines.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/(p|div|tr|h[1-6]|li|table|section|article|header|footer)>/gi,
    "\n",
  );
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return collapseEmailPlainWhitespace(stripQuotedReplyLines(text));
}

export function computeUniqueBodyText(
  bodyText: string,
  bodyHtml?: string | null,
): string {
  const fromPlain = stripQuotedReplyLines(bodyText);
  // MJML/ESP plain parts often dump CSS resets; that is not authored content.
  if (fromPlain.trim() && !looksLikeEmailCssLeak(fromPlain)) {
    return collapseEmailPlainWhitespace(fromPlain);
  }

  const fromHtml = stripHtmlQuotes(bodyHtml);
  if (fromHtml.trim()) return fromHtml;

  const scrubbed = collapseEmailPlainWhitespace(
    scrubEmailCssLeak(fromPlain),
  ).trim();
  return scrubbed || fromPlain;
}
