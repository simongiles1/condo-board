import Link from "next/link";

import { EmailSettingsClient } from "@/components/EmailSettingsClient";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/emails" className="text-sm text-teal-700 hover:underline">
            ← Back to inbox
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Email settings
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Connect Gmail accounts, manage the sender allowlist, and configure sync.
          </p>
        </div>
      </div>

      <EmailSettingsClient
        initialError={params.error ?? null}
        initialConnected={params.connected ?? null}
      />
    </section>
  );
}
