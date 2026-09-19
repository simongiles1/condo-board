"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { GoldCueSegmentMeta } from "@/lib/meeting-v2/segment-gold-standard";
import type { TranscriptSectionOverlay } from "@/lib/transcript/section-overlay";

export type MinimapCueLayout = {
  topRatio: number;
  heightRatio: number;
};

export type MinimapVisualBand = {
  topRatio: number;
  heightRatio: number;
  fill: string | null;
  overlap: boolean;
};

type MinimapBand = {
  cueCount: number;
  fill: string | null;
  overlap: boolean;
};

type MinimapScrollModel = {
  contentTop: number;
  contentHeight: number;
  viewportTopRatio: number;
  viewportHeightRatio: number;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildEqualMinimapCueLayouts(cueCount: number): MinimapCueLayout[] {
  if (cueCount <= 0) return [];
  const heightRatio = 1 / cueCount;
  return Array.from({ length: cueCount }, (_, index) => ({
    topRatio: index * heightRatio,
    heightRatio,
  }));
}

/** @deprecated cue-count bands; tests and equal-weight fallback only */
export function buildGoldMinimapBands(
  meta: GoldCueSegmentMeta[],
  colors: Map<string, string>,
): MinimapBand[] {
  const layouts = buildEqualMinimapCueLayouts(meta.length);
  return buildGoldMinimapVisualBands(meta, colors, layouts).map((band) => ({
    cueCount: Math.max(1, Math.round(band.heightRatio * meta.length)),
    fill: band.fill,
    overlap: band.overlap,
  }));
}

export function buildGoldMinimapVisualBands(
  meta: GoldCueSegmentMeta[],
  colors: Map<string, string>,
  layouts: MinimapCueLayout[],
): MinimapVisualBand[] {
  if (meta.length === 0 || layouts.length === 0) return [];

  const bands: MinimapVisualBand[] = [];
  let runSignature = bandSignature(meta[0].sections);
  let runOverlap = meta[0].sections.length > 1;
  let runTop = layouts[0].topRatio;
  let runEnd = layouts[0].topRatio + layouts[0].heightRatio;

  for (let index = 1; index < meta.length; index += 1) {
    const signature = bandSignature(meta[index].sections);
    const overlap = meta[index].sections.length > 1;
    const layout = layouts[index];
    if (signature === runSignature && overlap === runOverlap) {
      runEnd = layout.topRatio + layout.heightRatio;
      continue;
    }
    bands.push({
      topRatio: runTop,
      heightRatio: Math.max(0, runEnd - runTop),
      fill: sectionFillColor(meta[index - 1].sections, colors),
      overlap: runOverlap,
    });
    runSignature = signature;
    runOverlap = overlap;
    runTop = layout.topRatio;
    runEnd = layout.topRatio + layout.heightRatio;
  }

  bands.push({
    topRatio: runTop,
    heightRatio: Math.max(0, runEnd - runTop),
    fill: sectionFillColor(meta[meta.length - 1].sections, colors),
    overlap: runOverlap,
  });

  return bands;
}

function measureGoldCueLayouts(scrollRoot: HTMLElement): {
  layouts: MinimapCueLayout[];
  contentTop: number;
  contentHeight: number;
} | null {
  const rows = [...scrollRoot.querySelectorAll<HTMLElement>("[data-gold-cue-index]")].sort(
    (left, right) => Number(left.dataset.goldCueIndex) - Number(right.dataset.goldCueIndex),
  );
  if (rows.length === 0) return null;

  const rootRect = scrollRoot.getBoundingClientRect();
  const tops = rows.map((row) => row.getBoundingClientRect().top - rootRect.top + scrollRoot.scrollTop);
  const bottoms = rows.map(
    (row) => row.getBoundingClientRect().bottom - rootRect.top + scrollRoot.scrollTop,
  );

  const contentTop = tops[0];
  const contentBottom = bottoms[bottoms.length - 1];
  const contentHeight = Math.max(1, contentBottom - contentTop);

  const layouts = rows.map((_, index) => ({
    topRatio: (tops[index] - contentTop) / contentHeight,
    heightRatio: (bottoms[index] - tops[index]) / contentHeight,
  }));

  return { layouts, contentTop, contentHeight };
}

function measureViewport(
  scrollRoot: HTMLElement,
  contentTop: number,
  contentHeight: number,
): { viewportTopRatio: number; viewportHeightRatio: number } {
  const visibleTop = scrollRoot.scrollTop;
  const visibleBottom = scrollRoot.scrollTop + scrollRoot.clientHeight;
  const start = (visibleTop - contentTop) / contentHeight;
  const end = (visibleBottom - contentTop) / contentHeight;
  const viewportTopRatio = clamp01(start);
  const viewportHeightRatio = clamp01(end) - viewportTopRatio;
  return {
    viewportTopRatio,
    viewportHeightRatio: Math.max(0.01, viewportHeightRatio),
  };
}

function measureMinimapModel(
  scrollRoot: HTMLElement,
  meta: GoldCueSegmentMeta[],
  colors: Map<string, string>,
): {
  bands: MinimapVisualBand[];
  scroll: MinimapScrollModel;
} | null {
  const geometry = measureGoldCueLayouts(scrollRoot);
  if (!geometry) return null;

  const { layouts, contentTop, contentHeight } = geometry;
  const metaForLayouts =
    layouts.length === meta.length
      ? meta
      : meta.slice(0, layouts.length);

  const viewport = measureViewport(scrollRoot, contentTop, contentHeight);
  return {
    bands: buildGoldMinimapVisualBands(metaForLayouts, colors, layouts),
    scroll: {
      contentTop,
      contentHeight,
      ...viewport,
    },
  };
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
  const scrollModelRef = useRef<MinimapScrollModel | null>(null);
  const [bands, setBands] = useState<MinimapVisualBand[]>([]);
  const [viewport, setViewport] = useState({ topRatio: 0, heightRatio: 1 });

  useLayoutEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;

    function sync() {
      const model = measureMinimapModel(root, cueMeta, colors);
      if (!model) {
        const fallbackLayouts = buildEqualMinimapCueLayouts(cueMeta.length);
        setBands(buildGoldMinimapVisualBands(cueMeta, colors, fallbackLayouts));
        scrollModelRef.current = null;
        setViewport({ topRatio: 0, heightRatio: 1 });
        return;
      }
      scrollModelRef.current = model.scroll;
      setBands(model.bands);
      setViewport({
        topRatio: model.scroll.viewportTopRatio,
        heightRatio: model.scroll.viewportHeightRatio,
      });
    }

    sync();
    root.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    const grid = root.querySelector("[data-gold-compare-grid]");
    if (grid) observer.observe(grid);

    return () => {
      root.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [scrollContainerRef, cueMeta, colors]);

  function handleTrackClick(event: React.MouseEvent<HTMLDivElement>) {
    const root = scrollContainerRef.current;
    const track = trackRef.current;
    const scrollModel = scrollModelRef.current;
    if (!root || !track) return;

    const rect = track.getBoundingClientRect();
    const fraction = clamp01((event.clientY - rect.top) / rect.height);

    if (scrollModel) {
      const targetTop =
        scrollModel.contentTop +
        fraction * scrollModel.contentHeight -
        root.clientHeight / 2;
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      root.scrollTo({
        top: Math.max(0, Math.min(targetTop, maxTop)),
        behavior: "smooth",
      });
      return;
    }

    const targetTop = fraction * root.scrollHeight - root.clientHeight / 2;
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTo({
      top: Math.max(0, Math.min(targetTop, maxTop)),
      behavior: "smooth",
    });
  }

  const viewportTopPercent = viewport.topRatio * 100;
  const viewportHeightPercent = Math.max(1, viewport.heightRatio * 100);

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
          className="relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded border border-slate-300/90 bg-white shadow-inner"
          onClick={handleTrackClick}
        >
          {bands.map((band, index) => (
            <div
              key={index}
              className={`absolute inset-x-0 ${band.overlap ? "ring-1 ring-inset ring-slate-400/50" : ""}`}
              style={{
                top: `${band.topRatio * 100}%`,
                height: `${band.heightRatio * 100}%`,
                backgroundColor: band.fill ?? "#f1f5f9",
              }}
              title={band.fill ? "Labeled span" : "Unlabeled transcript"}
            />
          ))}
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
