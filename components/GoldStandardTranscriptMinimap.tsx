"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { GoldCueSegmentMeta } from "@/lib/meeting-v2/segment-gold-standard";
import type { TranscriptSectionOverlay } from "@/lib/transcript/section-overlay";

type MinimapBand = {
  cueCount: number;
  fill: string | null;
  overlap: boolean;
};

function bandSignature(sections: TranscriptSectionOverlay[]): string {
  if (sections.length === 0) return "";
  return sections
    .map((section) => section.id)
    .sort()
    .join("|");
}

function sectionFillColor(
  sections: TranscriptSectionOverlay[],
  colors: Map<string, string>,
): string | null {
  if (sections.length === 0) return null;
  const primary = sections[0];
  const hex = colors.get(primary.code.trim().toLowerCase() || primary.id);
  if (!hex) return null;
  return `color-mix(in srgb, ${hex} 42%, white)`;
}

export function buildGoldMinimapBands(
  meta: GoldCueSegmentMeta[],
  colors: Map<string, string>,
): MinimapBand[] {
  if (meta.length === 0) return [];

  const bands: MinimapBand[] = [];
  let runSignature = bandSignature(meta[0].sections);
  let runCount = 1;
  let runOverlap = meta[0].sections.length > 1;

  for (let index = 1; index < meta.length; index += 1) {
    const signature = bandSignature(meta[index].sections);
    const overlap = meta[index].sections.length > 1;
    if (signature === runSignature && overlap === runOverlap) {
      runCount += 1;
      continue;
    }
    bands.push({
      cueCount: runCount,
      fill: sectionFillColor(meta[index - runCount].sections, colors),
      overlap: runOverlap,
    });
    runSignature = signature;
    runCount = 1;
    runOverlap = overlap;
  }

  bands.push({
    cueCount: runCount,
    fill: sectionFillColor(meta[meta.length - runCount].sections, colors),
    overlap: runOverlap,
  });

  return bands;
}

type Props = {
  scrollContainerRef: RefObject<HTMLElement | null>;
  cueMeta: GoldCueSegmentMeta[];
  colors: Map<string, string>;
};

export function GoldStandardTranscriptMinimap({
  scrollContainerRef,
  cueMeta,
  colors,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ topRatio: 0, heightRatio: 1 });

  const bands = useMemo(() => buildGoldMinimapBands(cueMeta, colors), [cueMeta, colors]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;

    function syncViewport() {
      const { scrollTop, scrollHeight, clientHeight } = root!;
      if (scrollHeight <= 0) return;
      setViewport({
        topRatio: scrollTop / scrollHeight,
        heightRatio: Math.min(1, clientHeight / scrollHeight),
      });
    }

    syncViewport();
    root.addEventListener("scroll", syncViewport, { passive: true });
    const observer = new ResizeObserver(syncViewport);
    observer.observe(root);
    return () => {
      root.removeEventListener("scroll", syncViewport);
      observer.disconnect();
    };
  }, [scrollContainerRef, cueMeta.length]);

  function handleTrackClick(event: React.MouseEvent<HTMLDivElement>) {
    const root = scrollContainerRef.current;
    const track = trackRef.current;
    if (!root || !track) return;
    const rect = track.getBoundingClientRect();
    const fraction = (event.clientY - rect.top) / rect.height;
    const targetTop = fraction * root.scrollHeight - root.clientHeight / 2;
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTo({
      top: Math.max(0, Math.min(targetTop, maxTop)),
      behavior: "smooth",
    });
  }

  const viewportTopPercent = viewport.topRatio * 100;
  const viewportHeightPercent = Math.max(1.5, viewport.heightRatio * 100);

  return (
    <div
      className="sticky top-0 flex h-[calc(100vh-8rem)] w-8 shrink-0 flex-col border-l border-slate-200 bg-slate-50"
      aria-label="Gold-standard transcript overview"
    >
      <div className="border-b border-slate-200 px-1 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        Map
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-1">
        <div
          ref={trackRef}
          role="presentation"
          className="relative flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden rounded border border-slate-300/90 bg-white shadow-inner"
          onClick={handleTrackClick}
        >
          <div className="absolute inset-0 flex flex-col">
            {bands.map((band, index) => (
              <div
                key={index}
                className={`min-h-0 w-full ${band.overlap ? "ring-1 ring-inset ring-slate-400/50" : ""}`}
                style={{
                  flex: band.cueCount,
                  backgroundColor: band.fill ?? "#f1f5f9",
                }}
                title={band.fill ? "Labeled span" : "Unlabeled transcript"}
              />
            ))}
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 rounded-sm border-2 border-slate-800/75 bg-slate-900/10 shadow-sm"
            style={{
              top: `${viewportTopPercent}%`,
              height: `${viewportHeightPercent}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
