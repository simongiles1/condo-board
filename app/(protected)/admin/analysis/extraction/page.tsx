export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { AttachmentExtractionLabClient } from "@/components/AttachmentExtractionLabClient";

export default function AttachmentExtractionLabPage() {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AttachmentExtractionLabClient />
    </section>
  );
}
