import type { ReactNode } from "react";

import type { TextMatch } from "@/lib/transcript/search";

const MATCH_CLASS =
  "rounded-sm bg-yellow-200/90 text-yellow-950 box-decoration-clone px-0.5";
const CURRENT_MATCH_CLASS =
  "rounded-sm bg-orange-300 text-orange-950 ring-2 ring-orange-500 box-decoration-clone px-0.5";

type MatchWithIndex = TextMatch & {
  globalIndex: number;
};

type Props = {
  text: string;
  matches: MatchWithIndex[];
  currentMatchIndex: number;
};

export function SearchHighlightedText({
  text,
  matches,
  currentMatchIndex,
}: Props): ReactNode {
  if (matches.length === 0) return text;

  const parts: ReactNode[] = [];
  let lastEnd = 0;

  for (const match of matches) {
    if (match.start > lastEnd) {
      parts.push(text.slice(lastEnd, match.start));
    }

    const isCurrent = match.globalIndex === currentMatchIndex;
    parts.push(
      <mark
        key={match.globalIndex}
        data-match-index={match.globalIndex}
        className={isCurrent ? CURRENT_MATCH_CLASS : MATCH_CLASS}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    lastEnd = match.end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return parts;
}
