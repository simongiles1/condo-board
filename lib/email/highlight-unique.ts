/**
 * Locate the authored (unique) span inside a full email body for in-place highlight.
 *
 * Cut positions are always computed on a flattened form of the display body
 * (markdown links → labels, bare URLs dropped) so plain `bodyTextUnique` can
 * align to Turndown output without slicing mid-link or falling back to
 * soft-wrapped plain text.
 */

export type HighlightSplit = {
  highlighted: string;
  remainder: string;
  /**
   * True when `highlighted` is a prefix of the display body.
   * False when unique could not be located in-place — `highlighted` is the
   * mention unique string and `remainder` is the full display body.
   */
  aligned: boolean;
};

/** Index where same-thread reply history begins; null if none. */
export function findReplyQuoteStart(full: string): number | null {
  const patterns: RegExp[] = [
    /(?:^|\n)(On .+ wrote:\s*)(?:\n|$)/i,
    /(?:^|\n)(Le .+ a[ée]crit\s*:\s*)(?:\n|$)/i,
  ];

  let best: number | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(full);
    if (!match || match.index == null) continue;
    const index =
      full[match.index] === "\n" ? match.index + 1 : match.index;
    if (index === 0) continue;
    if (best == null || index < best) best = index;
  }
  return best;
}

/**
 * Split for UI highlight using reply-quote boundary in the displayed body.
 * When there is no reply quote, the entire body is "new" and is highlighted.
 */
export function splitAtReplyQuote(full: string): HighlightSplit | null {
  if (!full.trim()) return null;

  const start = findReplyQuoteStart(full);
  if (start == null) {
    return { highlighted: full, remainder: "", aligned: true };
  }
  if (start <= 0) {
    return null;
  }
  return {
    highlighted: full.slice(0, start),
    remainder: full.slice(start),
    aligned: true,
  };
}

/**
 * Collapse markdown links to their labels and drop bare URLs so plain unique
 * text (e.g. "www.pliteq.com") can align to Turndown output
 * ("[www.pliteq.com](http://www.pliteq.com)").
 *
 * Each flat character maps to an exclusive index in the original string; the
 * last character of a link label maps to the end of `](url)` so cuts never
 * land inside link syntax.
 */
export function flattenDisplayForMatch(content: string): {
  flat: string;
  origEnds: number[];
} {
  const flatChars: string[] = [];
  const origEnds: number[] = [];
  let i = 0;

  while (i < content.length) {
    if (content[i] === "[") {
      const close = content.indexOf("]", i + 1);
      const openParen = close >= 0 ? close + 1 : -1;
      if (
        close > i &&
        content[openParen] === "(" 
      ) {
        // Allow whitespace/newlines between ]( and closing )
        let parenEnd = -1;
        let depth = 0;
        for (let k = openParen; k < content.length; k++) {
          if (content[k] === "(") depth += 1;
          else if (content[k] === ")") {
            depth -= 1;
            if (depth === 0) {
              parenEnd = k;
              break;
            }
          }
        }
        if (parenEnd > openParen) {
          for (let j = i + 1; j < close; j++) {
            flatChars.push(content[j]!);
            origEnds.push(j + 1);
          }
          if (origEnds.length > 0) {
            origEnds[origEnds.length - 1] = parenEnd + 1;
          }
          i = parenEnd + 1;
          continue;
        }
      }
    }

    const urlMatch = content.slice(i).match(/^https?:\/\/[^\s)<]+/i);
    if (urlMatch) {
      i += urlMatch[0].length;
      continue;
    }

    flatChars.push(content[i]!);
    origEnds.push(i + 1);
    i += 1;
  }

  return { flat: flatChars.join(""), origEnds };
}

/**
 * End index in `full` such that collapsed-whitespace `full` prefix equals unique.
 * Punctuation is treated as a word separator (matching normalizeForPrefix).
 */
export function uniquePrefixEndIndex(
  full: string,
  unique: string,
): number | null {
  const uniqueNorm = normalizeForPrefix(unique);
  const fullNorm = normalizeForPrefix(full);
  if (!uniqueNorm || !fullNorm) return null;
  if (uniqueNorm === fullNorm) return full.length;
  if (!fullNorm.startsWith(uniqueNorm)) return null;

  let ui = 0;
  let pendingSpace = false;
  let started = false;

  for (let i = 0; i < full.length; i++) {
    const mapped = mapPrefixChar(full[i]!);
    if (mapped === null) {
      if (started) pendingSpace = true;
      continue;
    }
    if (mapped === " ") {
      if (!started) continue;
      pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      if (ui >= uniqueNorm.length || uniqueNorm[ui] !== " ") return null;
      ui += 1;
      pendingSpace = false;
    }

    started = true;
    if (ui >= uniqueNorm.length || uniqueNorm[ui] !== mapped) return null;
    ui += 1;
    if (ui === uniqueNorm.length) {
      let end = i + 1;
      while (end < full.length && mapPrefixChar(full[end]!) === null) {
        end += 1;
      }
      return end;
    }
  }

  return ui === uniqueNorm.length ? full.length : null;
}

function normalizeForPrefix(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\\([/'"*_`\[\]])/g, "$1")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapPrefixChar(ch: string): string | null {
  if (/\s/.test(ch)) return " ";
  const lower = ch.toLowerCase();
  if (/[\p{L}\p{N}]/u.test(lower)) return lower;
  return null;
}

/**
 * Split display body into highlighted unique prefix + remainder.
 * Always matches via flattened markdown so cuts never land inside `[label](url)`.
 */
export function splitBodyForHighlight(
  full: string,
  unique: string | null | undefined,
): HighlightSplit | null {
  if (!unique?.trim() || !full) return null;

  const uniqueNorm = normalizeForPrefix(unique);
  if (!uniqueNorm) return null;

  const { flat, origEnds } = flattenDisplayForMatch(full);
  if (!flat) return null;

  if (normalizeForPrefix(flat) === uniqueNorm) {
    return { highlighted: full, remainder: "", aligned: true };
  }

  const flatEnd = uniquePrefixEndIndex(flat, unique);
  if (flatEnd == null || flatEnd <= 0) return null;

  const origEnd = origEnds[flatEnd - 1] ?? full.length;
  if (origEnd >= full.length) {
    return { highlighted: full, remainder: "", aligned: true };
  }

  return {
    highlighted: full.slice(0, origEnd),
    remainder: full.slice(origEnd),
    aligned: true,
  };
}

function normalizeRough(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether a reply-quote split is a safe stand-in when unique→display alignment
 * failed. Rejects:
 * - whole-body "highlight" when unique is clearly shorter (forwards w/o On…wrote)
 * - nested On…wrote cuts that balloon far past unique (Outlook stacks with a
 *   Gmail attribution buried in quoted history)
 */
export function isReplySplitAcceptableForUnique(
  replySplit: HighlightSplit,
  uniqueText: string,
  displayContent: string,
): boolean {
  const uniqueLen = normalizeRough(uniqueText).length;
  const highlightLen = normalizeRough(replySplit.highlighted).length;
  const displayLen = normalizeRough(displayContent).length;
  if (!uniqueLen || !highlightLen) return false;

  if (!replySplit.remainder && uniqueLen < displayLen * 0.5) {
    return false;
  }

  // Allow modest display expansion (markdown links, typography) but not quote stacks.
  if (highlightLen > Math.max(uniqueLen * 1.5, uniqueLen + 40)) {
    return false;
  }

  return true;
}

/**
 * Resolve the teal unique span. Same string mentions search: in-place when
 * unique aligns to the display body; otherwise unique as the teal block and
 * the full display as remainder. Empty unique → no teal span.
 */
export function resolveUniqueHighlightSplit(
  displayContent: string,
  uniqueText: string | null | undefined,
): HighlightSplit | null {
  const unique = uniqueText?.trim() || "";
  if (!unique) return null;

  const uniqueOnDisplay = splitBodyForHighlight(displayContent, unique);
  if (uniqueOnDisplay) return uniqueOnDisplay;

  const replySplit = splitAtReplyQuote(displayContent);
  if (
    replySplit &&
    isReplySplitAcceptableForUnique(replySplit, unique, displayContent)
  ) {
    return replySplit;
  }

  return {
    highlighted: unique,
    remainder: displayContent,
    aligned: false,
  };
}

/**
 * LLM excerpt for contact extraction: same text the UI marks teal when
 * alignment works; otherwise the plain unique string (never a bloated
 * nested-quote prefix).
 */
export function resolveHighlightedExcerpt(
  displayContent: string,
  uniqueText: string | null | undefined,
): string {
  const unique = uniqueText?.trim() || "";
  if (!unique) return "";

  const split = resolveUniqueHighlightSplit(displayContent, unique);
  if (split?.highlighted.trim()) {
    return split.highlighted;
  }
  return unique;
}
