import { backgroundWorkersEnabled } from "@/lib/background-workers";

/** pdfjs-dist reads these during server import; Node 22 has no DOM canvas. */
function polyfillDomForPdfjs() {
  const g = globalThis as Record<string, unknown>;
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
          "[instrumentation] Background workers disabled (DISABLE_BACKGROUND_WORKERS=true); Telegram long-poll and fingerprint warmup skipped",
        );
        return;
      }

      void import("@/lib/organizations/fingerprint-list")
        .then(({ loadOrgFingerprintSummaries }) =>
          loadOrgFingerprintSummaries(),
        )
        .then((result) => {
          console.info("[instrumentation] Warmed org fingerprints", {
            organizations: result.organizations.length,
            merges: result.stats.mergeCount,
          });
        })
        .catch((error: unknown) => {
          console.error("[instrumentation] Org fingerprint warm failed", error);
        });

      void import("@/lib/projects/fingerprint-list")
        .then(({ loadProjectFingerprintSummaries }) =>
          loadProjectFingerprintSummaries(),
        )
        .then((result) => {
          console.info("[instrumentation] Warmed project fingerprints", {
            projects: result.projects.length,
            merges: result.stats.mergeCount,
          });
        })
        .catch((error: unknown) => {
          console.error(
            "[instrumentation] Project fingerprint warm failed",
            error,
          );
        });

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
      const { resumeIdentityReviewWorkersOnStartup } = await import(
        "@/lib/projects/identity-review-worker"
      );
      const { resumeBoardReportScanWorkersOnStartup } = await import(
        "@/lib/projects/board-report-worker"
      );
      startEmailScheduler();
      await resumePersonalForwardWorkflow();
      await resumeBulkExtractWorkersOnStartup();
      await resumeDoclingBackfillWorkersOnStartup();
      await resumeIdentityReviewWorkersOnStartup();
      await resumeBoardReportScanWorkersOnStartup();
      const { startTelegramRuntime } = await import("@/lib/telegram/polling");
      startTelegramRuntime();
    } catch (error) {
      console.error("[instrumentation] Startup failed:", error);
    }
  }
}
