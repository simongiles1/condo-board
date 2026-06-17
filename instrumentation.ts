export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEmailScheduler } = await import("@/lib/email/scheduler");
    const { resumePersonalForwardWorkflow } = await import(
      "@/lib/gmail/forward-workflow"
    );
    const { ensureDefaultUsers } = await import("@/lib/auth/session");
    startEmailScheduler();
    await resumePersonalForwardWorkflow();
    await ensureDefaultUsers();
  }
}
