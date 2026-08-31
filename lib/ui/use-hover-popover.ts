"use client";

import { useEffect, useRef, useState } from "react";

import { useHoverPopoverRowScanGroup } from "@/lib/ui/hover-popover-row";
import {
  HOVER_POPOVER_ATTR,
  POPOVER_CLOSE_DELAY_MS,
  claimHoverPopover,
  dismissActiveHoverPopoverIfDifferentGroup,
  ensureHoverPopoverScrollListener,
  hoverPopoverOpenDelayMs,
  isHoverSuppressedByScroll,
  noteHoverPopoverClosed,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

export { HoverPopoverRowProvider } from "@/lib/ui/hover-popover-row";

type Options = {
  enabled?: boolean;
  /** Join the one-at-a-time group. Nested sub-popovers should pass false. */
  group?: boolean;
  /**
   * Row identity for skip-delay scanning. Defaults to the nearest
   * `HoverPopoverRowProvider`. Triggers in different groups always use the
   * full open delay, even while another popover is open.
   */
  scanGroup?: string | null;
  /** Override open delay. `0` opens immediately (nested previews). */
  openDelayMs?: number;
  closeDelayMs?: number;
};

export function useHoverPopover(options: Options = {}) {
  const {
    enabled = true,
    group = true,
    closeDelayMs = POPOVER_CLOSE_DELAY_MS,
  } = options;
  const rowScanGroup = useHoverPopoverRowScanGroup();

  const instanceId = useRef(Symbol("hover-popover")).current;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const groupRef = useRef(group);
  groupRef.current = group;
  const closeDelayRef = useRef(closeDelayMs);
  closeDelayRef.current = closeDelayMs;
  const explicitOpenDelayRef = useRef(options.openDelayMs);
  explicitOpenDelayRef.current = options.openDelayMs;
  const scanGroupRef = useRef<string | null>(
    options.scanGroup ?? rowScanGroup ?? null,
  );
  scanGroupRef.current = options.scanGroup ?? rowScanGroup ?? null;

  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const holdOpenRef = useRef(false);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelOpen() {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function isKeptOpen() {
    return (
      triggerHoveredRef.current ||
      popoverHoveredRef.current ||
      holdOpenRef.current
    );
  }

  function forceClose() {
    const wasOpen = openRef.current;
    cancelOpen();
    cancelHide();
    triggerHoveredRef.current = false;
    popoverHoveredRef.current = false;
    holdOpenRef.current = false;
    openRef.current = false;
    setOpen(false);
    if (groupRef.current) releaseHoverPopover(instanceId);
    if (wasOpen) noteHoverPopoverClosed(scanGroupRef.current);
  }

  const forceCloseRef = useRef(forceClose);
  forceCloseRef.current = forceClose;

  function openNow() {
    if (!enabledRef.current) return;
    if (isHoverSuppressedByScroll()) return;
    cancelOpen();
    cancelHide();
    if (groupRef.current) {
      claimHoverPopover(
        instanceId,
        () => forceCloseRef.current(),
        scanGroupRef.current,
      );
    }
    openRef.current = true;
    setOpen(true);
  }

  function scheduleOpen() {
    if (!enabledRef.current) return;
    if (isHoverSuppressedByScroll()) return;
    cancelHide();
    if (openRef.current) return;
    const scanGroup = scanGroupRef.current;
    const delay =
      explicitOpenDelayRef.current ?? hoverPopoverOpenDelayMs(scanGroup);
    if (delay > 0 && groupRef.current) {
      dismissActiveHoverPopoverIfDifferentGroup(scanGroup);
    }
    if (delay <= 0) {
      openNow();
      return;
    }
    cancelOpen();
    openTimeoutRef.current = setTimeout(() => {
      openTimeoutRef.current = null;
      openNow();
    }, delay);
  }

  function scheduleHide() {
    cancelOpen();
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      if (!isKeptOpen()) forceCloseRef.current();
    }, closeDelayRef.current);
  }

  function onTriggerEnter() {
    triggerHoveredRef.current = true;
    scheduleOpen();
  }

  function onTriggerLeave() {
    triggerHoveredRef.current = false;
    scheduleHide();
  }

  function onTriggerFocus() {
    triggerHoveredRef.current = true;
    openNow();
  }

  function onTriggerBlur() {
    triggerHoveredRef.current = false;
    scheduleHide();
  }

  function onPopoverEnter() {
    popoverHoveredRef.current = true;
    cancelHide();
  }

  function onPopoverLeave() {
    popoverHoveredRef.current = false;
    scheduleHide();
  }

  function setHoldOpen(hovered: boolean) {
    holdOpenRef.current = hovered;
    if (hovered) cancelHide();
    else scheduleHide();
  }

  useEffect(() => {
    ensureHoverPopoverScrollListener();
  }, []);

  useEffect(() => {
    if (!enabled && openRef.current) forceCloseRef.current();
  }, [enabled]);

  useEffect(() => {
    return () => {
      cancelOpen();
      cancelHide();
      const wasOpen = openRef.current;
      openRef.current = false;
      if (groupRef.current) releaseHoverPopover(instanceId);
      if (wasOpen) noteHoverPopoverClosed(scanGroupRef.current);
    };
  }, [instanceId]);

  return {
    open,
    forceClose,
    cancelHide,
    scheduleHide,
    onTriggerEnter,
    onTriggerLeave,
    onTriggerFocus,
    onTriggerBlur,
    onPopoverEnter,
    onPopoverLeave,
    setHoldOpen,
    popoverProps: {
      [HOVER_POPOVER_ATTR]: "",
      onMouseEnter: onPopoverEnter,
      onMouseLeave: onPopoverLeave,
    },
  };
}
