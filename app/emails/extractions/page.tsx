export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";

import { ExtractionAuditClient } from "@/components/ExtractionAuditClient";
import { fetchExtractionAuditPage } from "@/lib/email/extraction-audit";

export default async function EmailExtractionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const { records, pagination } = await fetchExtractionAuditPage(page);

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/emails" className="text-sm text-teal-700 hover:underline">
            ← Back to inbox
          </Link>
          <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">
            Email AI audit
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Email extractions
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Human-readable view of what the AI extracted from each email and
            where those facts are stored — calendar, action items, financial
            tables, skill learning, and more.
          </p>
        </div>
      </div>

      <ExtractionAuditClient records={records} pagination={pagination} />
    </section>
  );
}
