"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  defaultDraftPdfMargins,
  draftPdfMarginsFrom,
  normalizeDraftPdfMargins,
  PdfMarginsFields,
  type DraftPdfMargins,
} from "@/components/PdfMarginsFields";
import {
  ATTACHMENT_VISIBILITY_SURFACE_LABELS,
  ATTACHMENT_VISIBILITY_SURFACES,
  type AttachmentVisibilitySettings,
} from "@/lib/email/attachment-visibility";
import {
  AVAILABLE_ANALYSIS_MODELS,
  DEFAULT_ANALYSIS_MODEL,
  formatAnalysisModelOptionLabel,
  isAllowedAnalysisModel,
  type AnalysisSettings,
} from "@/lib/email-analysis/settings-shared";
import { type PdfMargins } from "@/lib/pdf/margins";
import {
  DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS,
  normalizeAttachmentVisibilitySettings,
  updateAttachmentVisibilitySurface,
} from "@/lib/settings/attachment-visibility-settings";
import {
  AVAILABLE_GEMINI_MODELS,
  DEFAULT_MODEL_SETTINGS,
  formatModelOptionLabel,
  normalizeModelSettings,
  type GeminiModelId,
  type ModelSettings,
} from "@/lib/settings/model-settings";

type SettingsTab = "models" | "pdf" | "attachments" | "processed";

type Props = {
  open: boolean;
  settings: ModelSettings;
  pdfMargins: PdfMargins;
  attachmentVisibility: AttachmentVisibilitySettings;
  onClose: () => void;
  onSave: (
    settings: ModelSettings,
    pdfMargins: PdfMargins,
    attachmentVisibility: AttachmentVisibilitySettings,
  ) => void | Promise<void>;
};

function ModelSelect({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: GeminiModelId;
  onChange: (value: GeminiModelId) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as GeminiModelId)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
      >
        {AVAILABLE_GEMINI_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {formatModelOptionLabel(model)}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  );
}

function SettingsTabs({
  activeTab,
  onChange,
}: {
  activeTab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}) {
  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "models", label: "API models" },
    { id: "pdf", label: "PDF margins" },
    { id: "attachments", label: "Attachments" },
    { id: "processed", label: "Processed data" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex shrink-0 gap-1 border-b border-slate-100 px-6"
    >
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={[
              "-mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              selected
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function ModelSettingsDialog({
  open,
  settings,
  pdfMargins,
  attachmentVisibility,
  onClose,
  onSave,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [draft, setDraft] = useState<ModelSettings>(settings);
  const [marginDraft, setMarginDraft] = useState<DraftPdfMargins>(() =>
    draftPdfMarginsFrom(pdfMargins),
  );
  const [analysisDraft, setAnalysisDraft] = useState<AnalysisSettings | null>(
    null,
  );
  const [attachmentVisibilityDraft, setAttachmentVisibilityDraft] =
    useState<AttachmentVisibilitySettings>(attachmentVisibility);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmPurgeOpen, setConfirmPurgeOpen] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab("models");
      setDraft(normalizeModelSettings(settings));
      setMarginDraft(draftPdfMarginsFrom(pdfMargins));
      setAttachmentVisibilityDraft(
        normalizeAttachmentVisibilitySettings(attachmentVisibility),
      );
      setSaveError(null);
    }
  }, [open, settings, pdfMargins, attachmentVisibility]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setAnalysisLoading(true);

    void fetch("/api/analysis/settings")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load email analysis settings.");
        }
        return (await response.json()) as { settings: AnalysisSettings };
      })
      .then((data) => {
        if (!cancelled) {
          setAnalysisDraft(data.settings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSaveError(
            error instanceof Error
              ? error.message
              : "Could not load email analysis settings.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAnalysisLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function updateField<K extends keyof ModelSettings>(
    key: K,
    value: ModelSettings[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleReset() {
    setDraft({ ...DEFAULT_MODEL_SETTINGS });
    setMarginDraft(defaultDraftPdfMargins());
    setAttachmentVisibilityDraft(DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS);
    setAnalysisDraft((current) =>
      current
        ? { ...current, analysisModel: DEFAULT_ANALYSIS_MODEL }
        : {
            analysisModel: DEFAULT_ANALYSIS_MODEL,
            mergeModel: null,
            maxOutputTokens: 65536,
            extractionVersion: 1,
          },
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaveBusy(true);

    try {
      if (analysisDraft) {
        const response = await fetch("/api/analysis/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysisModel: analysisDraft.analysisModel,
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          settings?: AnalysisSettings;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not save email analysis settings.");
        }
        if (data.settings) {
          setAnalysisDraft(data.settings);
        }
      }

      await onSave(
        normalizeModelSettings(draft),
        normalizeDraftPdfMargins(marginDraft),
        normalizeAttachmentVisibilitySettings(attachmentVisibilityDraft),
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setSaveBusy(false);
    }
  }

  function updateMarginField(id: keyof PdfMargins, value: string) {
    setMarginDraft((current) => ({ ...current, [id]: value }));
  }

  async function confirmPurgeProcessedData() {
    setPurgeError(null);

    try {
      setPurgeBusy(true);

      const res = await fetch("/api/analysis/purge-processed-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body.error === "string"
            ? body.error
            : "Could not delete processed data.";
        throw new Error(msg);
      }

      setConfirmPurgeOpen(false);
      onClose();
      router.refresh();
    } catch (error) {
      setPurgeError(
        error instanceof Error ? error.message : "Unexpected error",
      );
    } finally {
      setPurgeBusy(false);
    }
  }

  const activeAnalysisModel =
    analysisDraft?.analysisModel ?? DEFAULT_ANALYSIS_MODEL;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-dialog-title"
        className="relative flex max-h-[min(90vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <h2
            id="model-settings-dialog-title"
            className="text-xl font-semibold text-slate-900"
          >
            Settings
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Configure AI models, PDF export margins, and processed data.
          </p>
        </div>

        <SettingsTabs activeTab={activeTab} onChange={setActiveTab} />

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {activeTab === "models" ? (
              <div className="space-y-6">
                <section className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Email analysis
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Used when analyzing ingested emails, attachments, and
                      bulk inbox runs.
                    </p>
                    {analysisLoading ? (
                      <p className="mt-2 text-xs text-slate-500">Loading…</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">
                        Currently active:{" "}
                        <span className="font-mono text-slate-800">
                          {activeAnalysisModel}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="model-email-analysis"
                      className="text-sm font-semibold text-slate-800"
                    >
                      Analysis model
                    </label>
                    <select
                      id="model-email-analysis"
                      value={activeAnalysisModel}
                      disabled={analysisLoading || !analysisDraft}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!isAllowedAnalysisModel(value)) return;
                        setAnalysisDraft((current) =>
                          current
                            ? { ...current, analysisModel: value }
                            : {
                                analysisModel: value,
                                mergeModel: null,
                                maxOutputTokens: 65536,
                                extractionVersion: 1,
                              },
                        );
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                    >
                      {AVAILABLE_ANALYSIS_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {formatAnalysisModelOptionLabel(modelId)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      Out/s in processing details measures total output tokens
                      over the full analysis job (body, attachments, DB), not
                      raw API streaming speed.
                    </p>
                  </div>
                </section>

                <section className="space-y-4 border-t border-slate-100 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Main run
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Used when generating a new meeting from transcript and
                      reference PDF.
                    </p>
                  </div>
                  <ModelSelect
                    id="model-main-minutes"
                    label="Meeting minutes"
                    description="Structured JSON extraction for the official minutes."
                    value={draft.mainMinutes}
                    onChange={(value) => updateField("mainMinutes", value)}
                  />
                  <ModelSelect
                    id="model-main-todos"
                    label="To-do list"
                    description="Markdown checklist of action items from the transcript."
                    value={draft.mainTodos}
                    onChange={(value) => updateField("mainTodos", value)}
                  />
                </section>

                <section className="space-y-4 border-t border-slate-100 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Omissions run
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Used when checking transcript coverage against existing
                      minutes and to-dos.
                    </p>
                  </div>
                  <ModelSelect
                    id="model-omissions-minutes"
                    label="Meeting minutes"
                    description="Compares transcript against the structured minutes JSON."
                    value={draft.omissionsMinutes}
                    onChange={(value) => updateField("omissionsMinutes", value)}
                  />
                  <ModelSelect
                    id="model-omissions-todos"
                    label="To-do list"
                    description="Compares transcript against the to-do markdown checklist."
                    value={draft.omissionsTodos}
                    onChange={(value) => updateField("omissionsTodos", value)}
                  />
                </section>
              </div>
            ) : null}

            {activeTab === "pdf" ? (
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    PDF margins
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Values are in points (72 pt ≈ 1 inch). Saved margins apply
                    to every PDF download.
                  </p>
                </div>
                <PdfMarginsFields
                  draft={marginDraft}
                  onChange={updateMarginField}
                />
              </section>
            ) : null}

            {activeTab === "attachments" ? (
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Low-value attachments
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    After AI analysis, logos, tracking pixels, and decorative
                    images are hidden by default. Turn on a surface below to show
                    them there again.
                  </p>
                </div>
                <ul className="space-y-3">
                  {ATTACHMENT_VISIBILITY_SURFACES.map((surface) => (
                    <li key={surface}>
                      <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={attachmentVisibilityDraft[surface]}
                          onChange={(event) => {
                            setAttachmentVisibilityDraft((current) =>
                              updateAttachmentVisibilitySurface(
                                current,
                                surface,
                                event.target.checked,
                              ),
                            );
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">
                            {ATTACHMENT_VISIBILITY_SURFACE_LABELS[surface]}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Show logos, tracking pixels, and other decorative
                            attachments in this view.
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {activeTab === "processed" ? (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Processed data
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Remove AI-generated results from emails and meetings.
                    Imported emails, threads, and attachments are kept.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPurgeError(null);
                    setConfirmPurgeOpen(true);
                  }}
                  className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:border-red-300 hover:bg-red-100"
                >
                  Delete all processed data…
                </button>
              </section>
            ) : null}
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
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveBusy || analysisLoading}
                  className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:opacity-50"
                >
                  {saveBusy ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmPurgeOpen}
        title="Delete all processed data?"
        description={
          <>
            <p>
              This permanently removes meeting workspaces, calendar events,
              extracted facts, action items, insights, and other AI-derived
              records.
            </p>
            <p className="mt-2">
              Your imported emails, threads, and attachment files will{" "}
              <strong>not</strong> be deleted. You can re-analyze them
              afterward.
            </p>
            {purgeError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                {purgeError}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete processed data"
        busy={purgeBusy}
        busyLabel="Deleting…"
        onConfirm={confirmPurgeProcessedData}
        onCancel={() => {
          if (!purgeBusy) {
            setConfirmPurgeOpen(false);
            setPurgeError(null);
          }
        }}
      />
    </div>
  );
}
