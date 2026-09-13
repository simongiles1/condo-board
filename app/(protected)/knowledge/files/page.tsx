export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { DocumentSeriesFilesClient } from "@/components/DocumentSeriesFilesClient";

export default function FilesPage() {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DocumentSeriesFilesClient />
    </section>
  );
}
