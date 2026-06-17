let chunkTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledRunId: string | null = null;

export function scheduleForwardChunk(runId: string, delayMs: number) {
  cancelForwardChunkTimer();
  scheduledRunId = runId;
  chunkTimer = setTimeout(() => {
    chunkTimer = null;
    scheduledRunId = null;
    void import("./forward-workflow").then((module) => {
      void module.processForwardChunk(runId);
    });
  }, delayMs);
}

export function cancelForwardChunkTimer() {
  if (chunkTimer) {
    clearTimeout(chunkTimer);
    chunkTimer = null;
    scheduledRunId = null;
  }
}

export function getForwardSchedulerStatus() {
  return {
    scheduled: chunkTimer !== null,
    runId: scheduledRunId,
  };
}
