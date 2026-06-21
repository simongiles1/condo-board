type ForceCloseFn = () => void;

let activeInstanceId: symbol | null = null;
let activeForceClose: ForceCloseFn | null = null;

/**
 * Global singleton for hover-triggered popovers so only one is visible at a time.
 *
 * When adding a new icon/badge popover anywhere in the app:
 * 1. Use a 500ms hide delay (`POPOVER_HIDE_DELAY_MS`) so users can move the
 *    pointer from trigger → popover without flicker.
 * 2. Track trigger + popover hover with refs; call `scheduleHide` on mouse leave
 *    and only close when neither is hovered after the delay.
 * 3. Call `claimHoverPopover(instanceId, forceClose)` when opening — this
 *    immediately closes any other open hover popover and cancels its hide timer.
 * 4. Call `releaseHoverPopover(instanceId)` from `forceClose` and on unmount.
 *
 * Reference implementations: `EmailExtractionBadge`, `EmailAttachmentsBadge`,
 * `ProcessedCostBadge`, `InsightSourceEmailsBadge`.
 */
export function claimHoverPopover(
  instanceId: symbol,
  forceClose: ForceCloseFn,
): void {
  if (activeInstanceId === instanceId) return;

  activeForceClose?.();
  activeInstanceId = instanceId;
  activeForceClose = forceClose;
}

export function releaseHoverPopover(instanceId: symbol): void {
  if (activeInstanceId !== instanceId) return;

  activeInstanceId = null;
  activeForceClose = null;
}

/** Closes every open hover popover in the group (e.g. before opening a click target). */
export function closeActiveHoverPopover(): void {
  activeForceClose?.();
  activeInstanceId = null;
  activeForceClose = null;
}
