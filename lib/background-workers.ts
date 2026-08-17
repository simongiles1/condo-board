/** Whether instrumentation should start schedulers and resume bulk workers. */
export function backgroundWorkersEnabled(): boolean {
  return (
    process.env.DISABLE_BACKGROUND_WORKERS?.trim().toLowerCase() !== "true"
  );
}

/**
 * Skip live verified mention counts on the entities list (uses mentionWeight).
 * Set SKIP_LIVE_MENTION_COUNTS=true for faster local UI iteration.
 */
export function skipLiveMentionCounts(): boolean {
  return (
    process.env.SKIP_LIVE_MENTION_COUNTS?.trim().toLowerCase() === "true"
  );
}
