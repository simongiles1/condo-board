"use client";

import { useEffect, useState } from "react";

import {
  defaultDraftPdfMargins,
  draftPdfMarginsFrom,
  normalizeDraftPdfMargins,
  PdfMarginsFields,
  type DraftPdfMargins,
} from "@/components/PdfMarginsFields";
import { PdfTemplatePreview } from "@/components/PdfTemplatePreview";
import {
  normalizePdfMargins,
  type PdfMargins,
} from "@/lib/pdf/margins";
import type { PdfTemplatePreviewContext } from "@/lib/pdf/template-preview";

type Props = {
  open: boolean;
  pdfMargins: PdfMargins;
  previewContext?: PdfTemplatePreviewContext;
  onClose: () => void;
  onSave: (pdfMargins: PdfMargins) => void | Promise<void>;
};

export function PdfTemplateDialog({
  open,
  pdfMargins,
  previewContext,
  onClose,
  onSave,
}: Props) {
  const [marginDraft, setMarginDraft] = useState<DraftPdfMargins>(() =>
    draftPdfMarginsFrom(pdfMargins),
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMarginDraft(draftPdfMarginsFrom(pdfMargins));
      setSaveError(null);
    }
  }, [open, pdfMargins]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saveBusy) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, saveBusy, onClose]);

  if (!open) return null;

  const previewMargins = normalizeDraftPdfMargins(marginDraft);

  function updateMarginField(id: keyof PdfMargins, value: string) {
    setMarginDraft((current) => ({ ...current, [id]: value }));
  }

  function handleReset() {
    setMarginDraft(defaultDraftPdfMargins());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaveBusy(true);

    try {
      await onSave(normalizePdfMargins(previewMargins));
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save PDF template.",
      );
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        onClick={saveBusy ? undefined : onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-template-dialog-title"
        className="relative flex max-h-[min(94vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <h2
            id="pdf-template-dialog-title"
            className="text-xl font-semibold text-slate-900"
          >
            PDF template
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Adjust margins and preview how page 1 title block and pages 2+
            running headers will render. Saved settings apply to every PDF
            export.
          </p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-8 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Margins
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Values are in points (72 pt ≈ 1 inch).
                  </p>
                </div>
                <PdfMarginsFields
                  draft={marginDraft}
                  onChange={updateMarginField}
                  showPreview={false}
                />
              </section>

              <section className="min-w-0 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Header preview
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Switch between page 1 and pages 2+, and toggle evaluated
                    values vs variable tokens.
                  </p>
                </div>
                <PdfTemplatePreview
                  margins={previewMargins}
                  previewContext={previewContext}
                />
              </section>
            </div>
          </div>

          <div className="shrink-0 space-y-3 border-t border-slate-100 px-6 py-4">
            {saveError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {saveError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
              >
                Reset to defaults
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saveBusy}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:opacity-50"
                >
                  {saveBusy ? "Saving…" : "Save template"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
