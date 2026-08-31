/**
 * Hover popover group timing tests.
 * Run: npx tsx --test scripts/test-hover-popover-group.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOVER_POPOVER_ATTR,
  POPOVER_CLOSE_DELAY_MS,
  POPOVER_OPEN_DELAY_MS,
  POPOVER_SCROLL_SUPPRESS_MS,
  POPOVER_SKIP_DELAY_MS,
  claimHoverPopover,
  closeActiveHoverPopover,
  hoverPopoverOpenDelayMs,
  isHoverSuppressedByScroll,
  noteHoverPopoverClosed,
  noteHoverPopoverScroll,
  resetHoverPopoverGroupForTests,
  setHoverPopoverClockForTests,
  shouldIgnoreScrollForHoverPopover,
  shouldSkipOpenDelay,
} from "../lib/ui/hover-popover-group";

describe("hover popover timing", () => {
  function setup() {
    resetHoverPopoverGroupForTests();
    let now = 1_000_000;
    setHoverPopoverClockForTests(() => now);
    return {
      advance(ms: number) {
        now += ms;
      },
    };
  }

  it("uses a 300ms open delay and 100ms close delay", () => {
    setup();
    assert.equal(POPOVER_OPEN_DELAY_MS, 300);
    assert.equal(POPOVER_CLOSE_DELAY_MS, 100);
    assert.equal(hoverPopoverOpenDelayMs(), 300);
  });

  it("skips the open delay while another popover is active in the same row", () => {
    setup();
    claimHoverPopover(Symbol("a"), () => undefined, "row-1");
    assert.equal(hoverPopoverOpenDelayMs("row-1"), 0);
    assert.equal(hoverPopoverOpenDelayMs("row-2"), POPOVER_OPEN_DELAY_MS);
  });

  it("skips the open delay shortly after a popover closes in the same row", () => {
    const clock = setup();
    noteHoverPopoverClosed("row-1");
    assert.equal(hoverPopoverOpenDelayMs("row-1"), 0);
    assert.equal(hoverPopoverOpenDelayMs("row-2"), POPOVER_OPEN_DELAY_MS);
    clock.advance(POPOVER_SKIP_DELAY_MS - 1);
    assert.equal(hoverPopoverOpenDelayMs("row-1"), 0);
    clock.advance(2);
    assert.equal(hoverPopoverOpenDelayMs("row-1"), POPOVER_OPEN_DELAY_MS);
  });

  it("does not skip the open delay across rows while another popover is active", () => {
    setup();
    claimHoverPopover(Symbol("a"), () => undefined, "row-1");
    assert.equal(shouldSkipOpenDelay("row-2"), false);
    assert.equal(hoverPopoverOpenDelayMs("row-2"), POPOVER_OPEN_DELAY_MS);
  });

  it("suppresses hover opens during and just after scroll", () => {
    const clock = setup();
    assert.equal(isHoverSuppressedByScroll(), false);
    noteHoverPopoverScroll();
    assert.equal(isHoverSuppressedByScroll(), true);
    clock.advance(POPOVER_SCROLL_SUPPRESS_MS - 1);
    assert.equal(isHoverSuppressedByScroll(), true);
    clock.advance(2);
    assert.equal(isHoverSuppressedByScroll(), false);
  });

  it("closes the active popover when closeActiveHoverPopover is called", () => {
    setup();
    let closed = 0;
    claimHoverPopover(Symbol("a"), () => {
      closed += 1;
    }, "row-1");
    closeActiveHoverPopover();
    assert.equal(closed, 1);
    assert.equal(hoverPopoverOpenDelayMs("row-1"), 0);
  });

  it("claiming a second popover force-closes the first", () => {
    setup();
    let closed = 0;
    claimHoverPopover(Symbol("a"), () => {
      closed += 1;
    });
    claimHoverPopover(Symbol("b"), () => undefined);
    assert.equal(closed, 1);
  });

  it("ignores scroll originating inside a hover popover", () => {
    assert.equal(shouldIgnoreScrollForHoverPopover(null), false);
    assert.equal(HOVER_POPOVER_ATTR, "data-hover-popover");
  });
});
