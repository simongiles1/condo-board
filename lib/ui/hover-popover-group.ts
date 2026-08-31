type ForceCloseFn = () => void;

let activeInstanceId: symbol | null = null;
let activeForceClose: ForceCloseFn | null = null;
/** Row/list identity for the open popover; skip-delay only applies within the same group. */
let activeScanGroup: string | null = null;
let lastClosedAt = 0;
let lastClosedScanGroup: string | null = null;
let scrollSuppressedUntil = 0;
let nowImpl = () => Date.now();
let scrollListenerBound = false;

/** Dwell before a hover popover opens. Accidental flyovers never reach this. */
export const POPOVER_OPEN_DELAY_MS = 300;
/** Grace to cross the gap from trigger → panel. Not a sticky dismissal. */
export const POPOVER_CLOSE_DELAY_MS = 100;
/** After a close in the same row, the next trigger in that row skips the open delay. */
export const POPOVER_SKIP_DELAY_MS = 400;
/** Ignore new hover-opens this long after a page scroll/wheel. */
export const POPOVER_SCROLL_SUPPRESS_MS = 150;

/** Mark popover panels so wheel/scroll inside them does not dismiss. */
export const HOVER_POPOVER_ATTR = "data-hover-popover";

export function hoverPopoverNow(): number {
  return nowImpl();
}

/**
 * Global singleton for hover-triggered popovers so only one is visible at a time.
 *
 * Prefer `useHoverPopover` instead of copying this by hand.
 *
 * When adding a new icon/badge popover:
 * 1. Use `useHoverPopover` (300ms open, 100ms close, row-scoped skip-delay, close on scroll).
 * 2. Keep click → side panel / primary action. Hover is preview only.
 * 3. Put `HOVER_POPOVER_ATTR` on the panel (`popoverProps` from the hook).
 * 4. `claimHoverPopover` still closes any other open hover popover immediately.
 */
function normalizeScanGroup(scanGroup?: string | null): string | null {
  return scanGroup ?? null;
}

function scanGroupsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalizeScanGroup(a) === normalizeScanGroup(b);
}

export function claimHoverPopover(
  instanceId: symbol,
  forceClose: ForceCloseFn,
  scanGroup?: string | null,
): void {
  if (activeInstanceId === instanceId) return;

  activeForceClose?.();
  activeInstanceId = instanceId;
  activeForceClose = forceClose;
  activeScanGroup = normalizeScanGroup(scanGroup);
}

export function releaseHoverPopover(instanceId: symbol): void {
  if (activeInstanceId !== instanceId) return;

  activeInstanceId = null;
  activeForceClose = null;
  activeScanGroup = null;
}

/** Closes every open hover popover in the group (e.g. before opening a click target). */
export function closeActiveHoverPopover(): void {
  const closer = activeForceClose;
  const closedScanGroup = activeScanGroup;
  const hadActive = closer != null;
  activeInstanceId = null;
  activeForceClose = null;
  activeScanGroup = null;
  closer?.();
  if (hadActive) noteHoverPopoverClosed(closedScanGroup);
}

export function noteHoverPopoverClosed(scanGroup?: string | null): void {
  lastClosedAt = hoverPopoverNow();
  lastClosedScanGroup = normalizeScanGroup(scanGroup);
}

export function noteHoverPopoverScroll(): void {
  scrollSuppressedUntil = hoverPopoverNow() + POPOVER_SCROLL_SUPPRESS_MS;
}

export function isHoverSuppressedByScroll(
  now = hoverPopoverNow(),
): boolean {
  return now < scrollSuppressedUntil;
}

export function shouldSkipOpenDelay(
  scanGroup?: string | null,
  now = hoverPopoverNow(),
): boolean {
  const group = normalizeScanGroup(scanGroup);
  if (activeInstanceId != null) {
    return scanGroupsMatch(activeScanGroup, group);
  }
  if (now - lastClosedAt < POPOVER_SKIP_DELAY_MS) {
    return scanGroupsMatch(lastClosedScanGroup, group);
  }
  return false;
}

/** Dismiss an open popover when entering a trigger in a different row/group. */
export function dismissActiveHoverPopoverIfDifferentGroup(
  scanGroup?: string | null,
): void {
  if (activeInstanceId == null) return;
  if (scanGroupsMatch(activeScanGroup, scanGroup)) return;
  closeActiveHoverPopover();
}

/** 0 when skip-delay applies; otherwise `POPOVER_OPEN_DELAY_MS`. */
export function hoverPopoverOpenDelayMs(
  scanGroup?: string | null,
  now = hoverPopoverNow(),
): number {
  return shouldSkipOpenDelay(scanGroup, now) ? 0 : POPOVER_OPEN_DELAY_MS;
}

export function shouldIgnoreScrollForHoverPopover(
  target: EventTarget | null,
): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(target.closest(`[${HOVER_POPOVER_ATTR}]`))
  );
}

function onScrollOrWheel(event: Event): void {
  if (shouldIgnoreScrollForHoverPopover(event.target)) return;
  noteHoverPopoverScroll();
  if (activeForceClose) closeActiveHoverPopover();
}

/** Bind once in the browser. Safe to call from every `useHoverPopover` mount. */
export function ensureHoverPopoverScrollListener(): void {
  if (typeof window === "undefined" || scrollListenerBound) return;
  scrollListenerBound = true;
  window.addEventListener("scroll", onScrollOrWheel, true);
  window.addEventListener("wheel", onScrollOrWheel, {
    capture: true,
    passive: true,
  });
}

/** @internal test-only clock. */
export function setHoverPopoverClockForTests(now: () => number): void {
  nowImpl = now;
}

/** @internal test-only reset. */
export function resetHoverPopoverGroupForTests(): void {
  activeInstanceId = null;
  activeForceClose = null;
  activeScanGroup = null;
  lastClosedAt = 0;
  lastClosedScanGroup = null;
  scrollSuppressedUntil = 0;
  nowImpl = () => Date.now();
}
