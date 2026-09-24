export type TextMatch = {
  start: number;
  end: number;
};

export type CueTextMatch = TextMatch & {
  cueIndex: number;
  globalIndex: number;
};

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];

  const regex = new RegExp(escapeRegExp(trimmed), "gi");
  const matches: TextMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  return matches;
}

export function findCueMatches(
  cues: { text: string }[],
  query: string,
): CueTextMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const matches: CueTextMatch[] = [];
  let globalIndex = 0;

  for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    for (const match of findTextMatches(cues[cueIndex].text, trimmed)) {
      matches.push({ ...match, cueIndex, globalIndex });
      globalIndex += 1;
    }
  }

  return matches;
}

/**
 * Height of the sticky section badge row that will cover the top of the scroll
 * viewport when the match's section is scrolled into view.
 */
function transcriptSectionStickyHeight(
  container: HTMLElement,
  child: HTMLElement,
): number {
  const section = child.closest("section");
  if (!section || !container.contains(section)) return 0;

  const sticky = section.querySelector(".sticky");
  if (!(sticky instanceof HTMLElement)) return 0;

  return sticky.offsetHeight;
}

/**
 * Scrolls a descendant into view inside a scrollable panel without using
 * `scrollIntoView`, which can move ancestor scrollers and mis-center content.
 */
export function scrollChildIntoContainer(
  container: HTMLElement,
  child: HTMLElement,
  paddingTop = 12,
): void {
  const stickyHeight = transcriptSectionStickyHeight(container, child);
  const topInset =
    stickyHeight > 0 ? stickyHeight + paddingTop : paddingTop + 8;

  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const nextTop =
    container.scrollTop + (childRect.top - containerRect.top) - topInset;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}
