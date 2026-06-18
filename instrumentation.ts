export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startEmailScheduler } = await import("@/lib/email/scheduler");
      const { resumePersonalForwardWorkflow } = await import(
        "@/lib/gmail/forward-workflow"
      );
      const { ensureDefaultUsers } = await import("@/lib/auth/session");
      startEmailScheduler();
      await resumePersonalForwardWorkflow();
      await ensureDefaultUsers();
    } catch (error) {
      console.error("[instrumentation] Startup failed:", error);
    }
  }
}
