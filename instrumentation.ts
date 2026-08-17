import { backgroundWorkersEnabled } from "@/lib/background-workers";

/** pdfjs-dist reads these during server import; Node 22 has no DOM canvas. */
function polyfillDomForPdfjs() {
  const g = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {};
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {};
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {};
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      polyfillDomForPdfjs();
      const { ensureDefaultUsers } = await import("@/lib/auth/session");
      await ensureDefaultUsers();

      if (!backgroundWorkersEnabled()) {
        console.info(
          "[instrumentation] Background workers disabled (DISABLE_BACKGROUND_WORKERS=true)",
        );
        const { startTelegramRuntime } = await import("@/lib/telegram/polling");
        startTelegramRuntime();
        return;
      }

      const { startEmailScheduler } = await import("@/lib/email/scheduler");
      const { resumePersonalForwardWorkflow } = await import(
        "@/lib/gmail/forward-workflow"
      );
      const { resumeBulkExtractWorkersOnStartup } = await import(
        "@/lib/email-analysis/bulk-extract-worker"
      );
      const { resumeDoclingBackfillWorkersOnStartup } = await import(
        "@/lib/email/docling-backfill-worker"
      );
      startEmailScheduler();
      await resumePersonalForwardWorkflow();
      await resumeBulkExtractWorkersOnStartup();
      await resumeDoclingBackfillWorkersOnStartup();
      const { startTelegramRuntime } = await import("@/lib/telegram/polling");
      startTelegramRuntime();
    } catch (error) {
      console.error("[instrumentation] Startup failed:", error);
    }
  }
}
