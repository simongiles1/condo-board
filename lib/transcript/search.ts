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

export function scrollChildIntoContainer(
  container: HTMLElement,
  child: HTMLElement,
  paddingTop = 20,
): void {
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const nextTop =
    container.scrollTop + (childRect.top - containerRect.top) - paddingTop;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}
