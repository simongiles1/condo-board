export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ExtractionAuditClient,
  ExtractionAuditMainTabs,
} from "@/components/ExtractionAuditClient";
import type { ExtractionAuditTabId } from "@/components/ExtractionAuditClient";
import { EXTRACTION_DESTINATIONS } from "@/lib/email/extraction-routing";
import {
  fetchExtractionAuditPage,
  fetchExtractionByTypePage,
} from "@/lib/email/extraction-audit";

function parseTab(value?: string): ExtractionAuditTabId {
  if (value === "routing" || value === "by-type") return value;
  return "list";
}

function parseDestination(value?: string): string {
  if (
    value &&
    EXTRACTION_DESTINATIONS.some((destination) => destination.id === value)
  ) {
    return value;
  }
  return EXTRACTION_DESTINATIONS[0]?.id ?? "metadata";
}

export default async function ExtractionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    destination?: string;
    typePage?: string;
  }>;
}) {
  const params = await searchParams;
  const activeTab = parseTab(params.tab);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const destination = parseDestination(params.destination);
  const typePage = Math.max(
    1,
    Number.parseInt(params.typePage ?? "1", 10) || 1,
  );

  const [{ records, pagination }, byTypeData] = await Promise.all([
    fetchExtractionAuditPage(page),
    fetchExtractionByTypePage(destination, typePage),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Email AI audit
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">Extractions</h1>
        </div>
        <ExtractionAuditMainTabs
          activeTab={activeTab}
          activeDestinationId={destination}
        />
      </div>

      <ExtractionAuditClient
        activeTab={activeTab}
        activeDestinationId={destination}
        records={records}
        pagination={pagination}
        byTypeRecords={byTypeData.records}
        byTypePagination={byTypeData.pagination}
        destinationCounts={byTypeData.destinationCounts}
      />
    </section>
  );
}
