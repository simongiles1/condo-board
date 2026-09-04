/** Movable text callouts attached to floor-plan boxes. Coordinates are PDF points. */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import type {
  FloorPlanAnnotation,
  FloorPlanCallout,
} from "@/lib/building/floor-plan-annotations";
import { pdfDeltaPerScreenPixel } from "@/lib/building/floor-plan-draw-snap";
import {
  boxCenter,
  boxEdgeToward,
  isConnectableBox,
  type ConnectableBox,
} from "@/lib/building/floor-plan-riser-links";

export const CALLOUT_FONT_PX = 12;
export const CALLOUT_PAD_X_PX = 8;
export const CALLOUT_PAD_Y_PX = 5;
export const CALLOUT_LINE_PX = 16;
export const CALLOUT_MAX_WIDTH_PX = 160;
export const CALLOUT_MIN_WIDTH_PX = 56;
export const CALLOUT_CHAR_PX = 7;
const DEFAULT_GAP_PT = 18;

function pointInRect(point: PdfPoint, rect: PdfRect, pad: number): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

function rayExitRect(
  center: PdfPoint,
  toward: PdfPoint,
  rect: PdfRect,
): PdfPoint {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  if (hw <= 0 || hh <= 0) return center;
  const tx = Math.abs(dx) < 1e-9 ? Infinity : hw / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-9 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t)) return center;
  return { x: center.x + dx * t, y: center.y + dy * t };
}

/** Word-wrap callout text so the bubble stays readable on the sheet. */
export function wrapCalloutLines(text: string, maxChars: number): string[] {
  const display = text.length > 0 ? text : "Label";
  const limit = Math.max(4, maxChars);
  const rawLines = display.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    if (raw.length <= limit) {
      lines.push(raw);
      continue;
    }
    let rest = raw;
    while (rest.length > limit) {
      let breakAt = rest.lastIndexOf(" ", limit);
      if (breakAt < limit / 2) breakAt = limit;
      lines.push(rest.slice(0, breakAt).trimEnd());
      rest = rest.slice(breakAt).trimStart();
    }
    if (rest) lines.push(rest);
  }
  return lines.length > 0 ? lines : [""];
}

export function calloutMaxChars(): number {
  return Math.max(
    8,
    Math.floor((CALLOUT_MAX_WIDTH_PX - CALLOUT_PAD_X_PX * 2) / CALLOUT_CHAR_PX),
  );
}

export type CalloutBubbleScreen = {
  widthPx: number;
  heightPx: number;
  lines: string[];
};

export function calloutBubbleScreenSize(text: string): CalloutBubbleScreen {
  const lines = wrapCalloutLines(text, calloutMaxChars());
  const longest = Math.max(...lines.map((line) => line.length), 4);
  const widthPx = Math.min(
    CALLOUT_MAX_WIDTH_PX,
    Math.max(CALLOUT_MIN_WIDTH_PX, longest * CALLOUT_CHAR_PX + CALLOUT_PAD_X_PX * 2),
  );
  const heightPx = lines.length * CALLOUT_LINE_PX + CALLOUT_PAD_Y_PX * 2;
  return { widthPx, heightPx, lines };
}

export function calloutBubbleSizePt(
  text: string,
  layoutScale: number,
  zoom: number,
): { width: number; height: number } {
  const { widthPx, heightPx } = calloutBubbleScreenSize(text);
  const pxToPt = pdfDeltaPerScreenPixel(layoutScale, zoom);
  return { width: widthPx * pxToPt, height: heightPx * pxToPt };
}

export function calloutBubbleRect(
  callout: FloorPlanCallout,
  size: { width: number; height: number },
): PdfRect {
  return {
    x: callout.x - size.width / 2,
    y: callout.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

/** Upper-right of the box so the leader has room to draw. */
export function defaultCalloutPosition(
  item: ConnectableBox,
  gapPt = DEFAULT_GAP_PT,
): PdfPoint {
  return {
    x: item.rect.x + item.rect.width + gapPt,
    y: item.rect.y + item.rect.height + gapPt,
  };
}

export function defaultCallout(item: ConnectableBox): FloorPlanCallout {
  const point = defaultCalloutPosition(item);
  return { x: point.x, y: point.y, text: "" };
}

/** Copy callout text onto another box at its default bubble position. */
export function duplicateCallout(
  source: FloorPlanCallout,
  target: ConnectableBox,
): FloorPlanCallout {
  const point = defaultCalloutPosition(target);
  const next: FloorPlanCallout = { x: point.x, y: point.y, text: source.text };
  if (source.riserId) next.riserId = source.riserId;
  if (source.riserIds?.length) next.riserIds = [...source.riserIds];
  if (source.typeId) next.typeId = source.typeId;
  return next;
}

/** Leader from the bubble edge to the box edge; arrow belongs at `end`. */
export function calloutLeaderEndpoints(
  box: ConnectableBox,
  calloutCenter: PdfPoint,
  bubble: { width: number; height: number },
): { start: PdfPoint; end: PdfPoint } | null {
  const boxMid = boxCenter(box);
  if (Math.hypot(calloutCenter.x - boxMid.x, calloutCenter.y - boxMid.y) < 0.5) {
    return null;
  }
  const bubbleRect = calloutBubbleRect(
    { x: calloutCenter.x, y: calloutCenter.y, text: "" },
    bubble,
  );
  return {
    start: rayExitRect(calloutCenter, boxMid, bubbleRect),
    end: boxEdgeToward(box, calloutCenter),
  };
}

export function translateCallout(
  callout: FloorPlanCallout,
  dx: number,
  dy: number,
): FloorPlanCallout {
  return { ...callout, x: callout.x + dx, y: callout.y + dy };
}

/** Topmost callout bubble under `point`, or null. */
export function hitTestCallout(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  layoutScale: number,
  zoom: number,
): number | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const item = annotations[i];
    if (!isConnectableBox(item) || item.callout == null) continue;
    const size = calloutBubbleSizePt(item.callout.text, layoutScale, zoom);
    if (pointInRect(point, calloutBubbleRect(item.callout, size), 0)) {
      return i;
    }
  }
  return null;
}
