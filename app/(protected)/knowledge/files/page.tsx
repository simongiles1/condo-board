export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { FilesPageClient } from "@/components/FilesPageClient";
import { FILE_CATEGORY_ORDER } from "@/lib/email/file-categories";
import { loadCategorizedFiles } from "@/lib/email/load-categorized-files";

export default async function FilesPage() {
  const categorizedFiles = await loadCategorizedFiles();
  const totalCount = FILE_CATEGORY_ORDER.reduce(
    (sum, category) => sum + categorizedFiles[category].length,
    0,
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Email attachments
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Files ({totalCount})
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Attachments from synced emails, organized by document type.
        </p>
      </div>

      <FilesPageClient categorizedFiles={categorizedFiles} />
    </section>
  );
}
