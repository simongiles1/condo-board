import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp } from "@/lib/parsers/vtt";
import { SearchHighlightedText } from "@/components/SearchHighlightedText";
import type { CueTextMatch } from "@/lib/transcript/search";

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
};

export function ReadableTranscriptView({
  cues,
  searchQuery = "",
  matches = [],
  currentMatchIndex = 0,
}: Props) {
  const hasSearch = searchQuery.trim().length > 0;

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

        return (
          <article
            key={`${cue.start}-${cue.speaker}-${index}`}
            className="px-2.5 py-1"
            style={{ backgroundColor: speakerBackgroundColor(cue.speaker) }}
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
