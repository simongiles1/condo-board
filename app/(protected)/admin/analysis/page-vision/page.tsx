export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { PageVisionLabClient } from "@/components/PageVisionLabClient";

export default function PageVisionLabPage() {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageVisionLabClient />
    </section>
  );
}
