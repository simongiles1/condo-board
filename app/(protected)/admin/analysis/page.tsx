export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { AnalysisLabClient } from "@/components/AnalysisLabClient";

export default function AnalysisPage() {
  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <AnalysisLabClient />
    </section>
  );
}
