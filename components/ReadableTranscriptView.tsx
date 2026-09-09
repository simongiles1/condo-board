import type { RefObject } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp, parseVttTimestampMs } from "@/lib/parsers/vtt";
import { SearchHighlightedText } from "@/components/SearchHighlightedText";
import type { CueTextMatch } from "@/lib/transcript/search";
import {
  groupCuesByTranscriptSections,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";

function cueOverlapsRange(
  cue: MergedVttCue,
  [startMs, endMs]: [number, number],
): boolean {
  const cueStart = parseVttTimestampMs(cue.start);
  const cueEnd = parseVttTimestampMs(cue.end);
  return cueEnd >= startMs && cueStart <= endMs;
}

function normalizeHighlightRanges(
  highlightRangeMs?: [number, number],
  highlightRangesMs?: Array<[number, number]>,
): Array<[number, number]> {
  if (highlightRangesMs && highlightRangesMs.length > 0) return highlightRangesMs;
  return highlightRangeMs ? [highlightRangeMs] : [];
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

const SECTION_BORDER_COLORS = [
  "#7f1d1d",
  "#2563eb",
  "#047857",
  "#b45309",
  "#6d28d9",
  "#be185d",
];

type Props = {
  cues: MergedVttCue[];
  searchQuery?: string;
  matches?: CueTextMatch[];
  currentMatchIndex?: number;
  highlightRangeMs?: [number, number];
  highlightRangesMs?: Array<[number, number]>;
  firstHighlightRef?: RefObject<HTMLElement | null>;
  sectionOverlays?: TranscriptSectionOverlay[];
  showSectionOverlay?: boolean;
  onSectionClick?: (section: TranscriptSectionOverlay) => void;
};

function sectionLabel(section: TranscriptSectionOverlay): string {
  return section.title ? `${section.code} — ${section.title}` : section.code;
}

function CueArticle({
  cue,
  index,
  hasSearch,
  matches,
  currentMatchIndex,
  highlightRanges,
  cueRef,
}: {
  cue: MergedVttCue;
  index: number;
  hasSearch: boolean;
  matches: CueTextMatch[];
  currentMatchIndex: number;
  highlightRanges: Array<[number, number]>;
  cueRef?: RefObject<HTMLElement | null>;
}) {
  const cueMatches = matches
    .filter((match) => match.cueIndex === index)
    .map((match) => ({
      start: match.start,
      end: match.end,
      globalIndex: match.globalIndex,
    }));

  const inHighlightRange =
    highlightRanges.length === 0 || highlightRanges.some((range) => cueOverlapsRange(cue, range));

  return (
    <article
      ref={cueRef}
      className={`px-2.5 py-1 transition-opacity ${
        highlightRanges.length > 0 && !inHighlightRange ? "opacity-35" : ""
      }`}
      style={{
        backgroundColor:
          highlightRanges.length > 0 && !inHighlightRange
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
}

export function ReadableTranscriptView({
  cues,
  searchQuery = "",
  matches = [],
  currentMatchIndex = 0,
  highlightRangeMs,
  highlightRangesMs,
  firstHighlightRef,
  sectionOverlays = [],
  showSectionOverlay = false,
  onSectionClick,
}: Props) {
  const hasSearch = searchQuery.trim().length > 0;
  const highlightRanges = normalizeHighlightRanges(highlightRangeMs, highlightRangesMs);
  let firstHighlightAssigned = false;

  function cueRefFor(index: number): RefObject<HTMLElement | null> | undefined {
    if (highlightRanges.length === 0 || !firstHighlightRef || firstHighlightAssigned) return undefined;
    const cue = cues[index];
    if (!highlightRanges.some((range) => cueOverlapsRange(cue, range))) return undefined;
    firstHighlightAssigned = true;
    return firstHighlightRef;
  }

  const renderCue = (index: number) => (
    <CueArticle
      key={`${cues[index].start}-${cues[index].speaker}-${index}`}
      cue={cues[index]}
      index={index}
      hasSearch={hasSearch}
      matches={matches}
      currentMatchIndex={currentMatchIndex}
      highlightRanges={highlightRanges}
      cueRef={cueRefFor(index)}
    />
  );

  if (!showSectionOverlay || sectionOverlays.length === 0) {
    return <div>{cues.map((_, index) => renderCue(index))}</div>;
  }

  const groups = groupCuesByTranscriptSections(cues, sectionOverlays);
  const colorBySectionId = new Map<string, string>();
  let colorCursor = 0;
  for (const overlay of sectionOverlays) {
    if (colorBySectionId.has(overlay.id)) continue;
    colorBySectionId.set(
      overlay.id,
      SECTION_BORDER_COLORS[colorCursor % SECTION_BORDER_COLORS.length],
    );
    colorCursor += 1;
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, groupIndex) => {
        const articles = group.cueIndexes.map((index) => renderCue(index));
        if (group.sections.length === 0) {
          return (
            <div key={`unassigned-${groupIndex}`}>
              {articles}
            </div>
          );
        }

        const primary = group.sections[0];
        const borderColor = colorBySectionId.get(primary.id) ?? SECTION_BORDER_COLORS[0];
        const isOverlap = group.sections.length > 1;

        return (
          <section
            key={`${group.sections.map((section) => section.id).join("+")}-${groupIndex}`}
            className="relative rounded-lg border-2 pb-1"
            style={{ borderColor }}
          >
            <div className="sticky top-0 z-[1] flex justify-center">
              <div className="flex w-full flex-wrap justify-center gap-1 bg-gradient-to-b from-white from-50% to-transparent py-1">
                {isOverlap ? (
                  <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Overlap
                  </span>
                ) : null}
                {group.sections.map((section) => {
                  const color = colorBySectionId.get(section.id) ?? borderColor;
                  const label = sectionLabel(section);
                  const overlapTitle = isOverlap
                    ? `Overlap: ${group.sections.map(sectionLabel).join(" · ")}`
                    : label;
                  const className =
                    "max-w-[90%] truncate rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold shadow-sm";
                  if (onSectionClick) {
                    return (
                      <button
                        key={`${section.id}-${section.startSeconds}`}
                        type="button"
                        className={`${className} cursor-pointer hover:bg-slate-50`}
                        style={{ borderColor: color, color }}
                        title={`${overlapTitle} — view linked chunks`}
                        onClick={() => onSectionClick(section)}
                      >
                        {label}
                      </button>
                    );
                  }
                  return (
                    <span
                      key={`${section.id}-${section.startSeconds}`}
                      className={className}
                      style={{ borderColor: color, color }}
                      title={overlapTitle}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="overflow-hidden rounded-b-md">{articles}</div>
          </section>
        );
      })}
    </div>
  );
}
