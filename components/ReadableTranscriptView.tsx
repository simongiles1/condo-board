import type { RefObject } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp, parseVttTimestampMs } from "@/lib/parsers/vtt";
import { SearchHighlightedText } from "@/components/SearchHighlightedText";
import type { CueTextMatch } from "@/lib/transcript/search";

function cueOverlapsRange(
  cue: MergedVttCue,
  [startMs, endMs]: [number, number],
): boolean {
  const cueStart = parseVttTimestampMs(cue.start);
  const cueEnd = parseVttTimestampMs(cue.end);
  return cueEnd >= startMs && cueStart <= endMs;
}

/** Stable, very light background per speaker name. */
export function speakerBackgroundColor(speaker: string): string {
  const key = speaker.trim().toLowerCase() || "__unknown__";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 42% 95%)`;
}

type Props = {
  cues: MergedVttCue[];
  searchQuery?: string;
  matches?: CueTextMatch[];
  currentMatchIndex?: number;
  highlightRangeMs?: [number, number];
  firstHighlightRef?: RefObject<HTMLElement | null>;
};

export function ReadableTranscriptView({
  cues,
  searchQuery = "",
  matches = [],
  currentMatchIndex = 0,
  highlightRangeMs,
  firstHighlightRef,
}: Props) {
  const hasSearch = searchQuery.trim().length > 0;
  let firstHighlightAssigned = false;

  return (
    <div>
      {cues.map((cue, index) => {
        const cueMatches = matches
          .filter((match) => match.cueIndex === index)
          .map((match) => ({
            start: match.start,
            end: match.end,
            globalIndex: match.globalIndex,
          }));

        const inHighlightRange =
          highlightRangeMs ? cueOverlapsRange(cue, highlightRangeMs) : true;

        let cueRef: RefObject<HTMLElement | null> | undefined;
        if (highlightRangeMs && inHighlightRange && firstHighlightRef && !firstHighlightAssigned) {
          cueRef = firstHighlightRef;
          firstHighlightAssigned = true;
        }

        return (
          <article
            key={`${cue.start}-${cue.speaker}-${index}`}
            ref={cueRef}
            className={`px-2.5 py-1 transition-opacity ${
              highlightRangeMs && !inHighlightRange ? "opacity-35" : ""
            }`}
            style={{
              backgroundColor: highlightRangeMs && !inHighlightRange
                ? "transparent"
                : speakerBackgroundColor(cue.speaker),
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-slate-900">
                {cue.speaker.trim() || "Unknown"}
              </span>
              <time
                dateTime={cue.start}
                className="shrink-0 font-mono text-xs tabular-nums text-slate-500"
              >
                {formatVttTimestamp(cue.start)}
              </time>
            </div>
            <p className="mt-0.5 text-sm leading-snug text-slate-800">
              {hasSearch ? (
                <SearchHighlightedText
                  text={cue.text}
                  matches={cueMatches}
                  currentMatchIndex={currentMatchIndex}
                />
              ) : (
                cue.text
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}
