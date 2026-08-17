import TurndownService from "turndown";

/**
 * Display formatting for stored email bodies.
 *
 * Gmail (and most clients) send multipart/alternative: a soft-wrapped text/plain
 * part (~72-char lines) plus text/html with real paragraphs. We already store
 * both; display must prefer HTML. Blind newline stripping is wrong because it
 * destroys intentional breaks (greetings, lists, signatures, quoted replies).
 */

export type EmailBodyDisplay =
  | { kind: "markdown"; content: string }
  | { kind: "text"; content: string };

const emailTurndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  bulletListMarker: "-",
});

// Gmail composes with nested <div>s instead of <p>; treat them as paragraphs.
emailTurndown.addRule("gmailDiv", {
  filter: (node) => {
    if (node.nodeName !== "DIV") return false;
    // Keep quote containers / structured blocks for other rules
    const className = typeof node.className === "string" ? node.className : "";
    if (className.includes("gmail_quote") || className.includes("gmail_attr")) {
      return false;
    }
    return true;
  },
  replacement: (content) => {
    const trimmed = content.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!trimmed) return "\n\n";
    return `\n\n${trimmed}\n\n`;
  },
});

export function emailHtmlToMarkdown(html: string): string {
  return emailTurndown
    .turndown(sanitizeEmailHtml(html))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Outlook / Word HTML often embeds font + style blobs in comments or <style>
 * that Turndown would otherwise leak as visible body text.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * MJML / ConciergePlus / many ESP plain-text parts dump CSS resets at the top
 * (#outlook, .mj-column-*, -webkit-text-size-adjust, …). That is not readable
 * body content — prefer HTML when this is detected.
 */
export function looksLikeEmailCssLeak(text: string): boolean {
  const head = text.slice(0, 1200);
  if (/#outlook\b/i.test(head)) return true;
  if (/-webkit-text-size-adjust/i.test(head)) return true;
  if (/mso-table-lspace/i.test(head)) return true;
  if (/\.mj-(column|outlook|full-width)/i.test(head)) return true;
  if (/@media\s+only\s+screen/i.test(head) && /\{[^}]*width\s*:/i.test(head)) {
    return true;
  }
  return false;
}

function looksLikeCssNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^#outlook\b/i.test(t)) return true;
  if (/@(media|font-face|import)\b/i.test(t)) return true;
  if (/\.(mj-|moz-|Mso)/i.test(t)) return true;
  if (/-webkit-|-ms-|mso-/i.test(t)) return true;
  if (/!important\b/i.test(t)) return true;
  if (/[{};]/.test(t) && /:\s*[^;]+/.test(t)) return true;
  if (/^(body|table|td|img|p|a|div|html)\s*[{,]/.test(t)) return true;
  return false;
}

/** Best-effort: drop a leading CSS dump from a polluted plain-text part. */
export function scrubEmailCssLeak(text: string): string {
  if (!looksLikeEmailCssLeak(text)) return text;
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && looksLikeCssNoiseLine(lines[i]!)) i++;
  while (i < lines.length && /^[}\s]*$/.test(lines[i]!)) i++;
  return collapseEmailPlainWhitespace(lines.slice(i).join("\n"));
}

/**
 * MJML/table HTML → text leaves indent-only lines that look blank but don't
 * match /\n{3,}/. Normalize those so display isn't a sea of whitespace.
 */
export function collapseEmailPlainWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Re-flow plain-text soft wraps without deleting real structure.
 *
 * Joins a line to the previous when it looks like a column wrap (RFC 3676
 * format=flowed trailing space, or a long mid-phrase line), while keeping
 * blank lines, quote markers, list items, and short intentional breaks.
 */
export function unwrapSoftLineBreaks(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    // Indent-only lines from HTML stripping must become real blanks so
    // \n{3,} can collapse them — but keep trailing spaces on non-empty
    // lines (format=flowed soft wraps).
    .map((line) => (line.trim() === "" ? "" : line));
  const out: string[] = [];

  for (const line of lines) {
    if (out.length === 0) {
      out.push(line);
      continue;
    }

    const prev = out[out.length - 1]!;
    if (shouldJoinSoftWrap(prev, line)) {
      out[out.length - 1] = `${prev.replace(/[ \t]+$/, "")} ${line.replace(/^[ \t]+/, "")}`;
    } else {
      out.push(line);
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function shouldJoinSoftWrap(prev: string, curr: string): boolean {
  if (prev === "" || curr === "") return false;
  if (isQuoteLine(prev) || isQuoteLine(curr)) return false;
  if (isListItem(curr)) return false;
  if (isSignatureDelimiter(prev) || isSignatureDelimiter(curr)) return false;

  // RFC 3676 format=flowed: a single trailing space marks a soft break.
  if (/[^ \t] $/.test(prev)) return true;

  const prevTrimmed = prev.replace(/[ \t]+$/g, "");
  const currTrimmed = curr.replace(/^[ \t]+/g, "");
  if (!prevTrimmed || !currTrimmed) return false;

  // Next line continues a sentence (lowercase) → soft wrap, even when the
  // previous fragment is short ("emphasize the" / "seriousness of…").
  if (/^[a-z(]/.test(currTrimmed)) return true;

  // Short previous line + capital next → intentional break (greeting, sign-off).
  if (prevTrimmed.length < 40) return false;

  // Previous line ends mid-phrase (word/comma) and is near wrap width.
  if (
    prevTrimmed.length >= 55 &&
    /[a-zA-Z0-9,;]$/.test(prevTrimmed)
  ) {
    return true;
  }

  // Classic fixed-column wrap (~72 chars), even after ". " mid-paragraph.
  if (prevTrimmed.length >= 65) return true;

  return false;
}

function isQuoteLine(line: string): boolean {
  return /^\s*>/.test(line);
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*•]|#{1,6}|\d+[.)])\s+/.test(line);
}

function isSignatureDelimiter(line: string): boolean {
  return /^--\s*$/.test(line);
}

/** Prefer HTML (via markdown) when present; otherwise unwrap plain text. */
export function formatEmailBodyForDisplay(
  bodyText: string,
  bodyHtml?: string | null,
): EmailBodyDisplay {
  if (bodyHtml?.trim()) {
    const content = emailHtmlToMarkdown(bodyHtml);
    if (content) return { kind: "markdown", content };
  }

  const cleaned = scrubEmailCssLeak(bodyText);
  const unwrapped = unwrapSoftLineBreaks(cleaned);
  return { kind: "text", content: unwrapped || cleaned || bodyText };
}
