"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_PDF_MARGINS,
  loadPdfMargins,
  pdfMarginsSearchParams,
  type PdfMargins,
} from "@/lib/pdf/margins";

type Props = {
  meetingId: string;
  disabled?: boolean;
};

export function PdfExportControls({ meetingId, disabled }: Props) {
  const [margins, setMargins] = useState<PdfMargins>(DEFAULT_PDF_MARGINS);

  useEffect(() => {
    setMargins(loadPdfMargins());
  }, []);

  const exportHref = `/api/export/${meetingId}?${pdfMarginsSearchParams(margins)}`;

  if (disabled) {
    return (
      <span className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white opacity-60">
        Download PDF
      </span>
    );
  }

  return (
    <a
      className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
      href={exportHref}
    >
      Download PDF
    </a>
  );
}
