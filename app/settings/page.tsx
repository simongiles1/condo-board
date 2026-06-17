import { redirect } from "next/navigation";

import { EmailSettingsClient } from "@/components/EmailSettingsClient";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect Gmail accounts, manage the sender allowlist, and configure sync.
        </p>
      </div>

      <EmailSettingsClient
        initialError={params.error ?? null}
        initialConnected={params.connected ?? null}
      />
    </section>
  );
}
