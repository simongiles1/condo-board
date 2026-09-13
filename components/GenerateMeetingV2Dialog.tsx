"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { FileDropzone } from "@/components/FileDropzone";
import { VttViewerDialog } from "@/components/VttViewerDialog";
import { formatDateTime } from "@/lib/format/datetime";
import type {
  BoardPackageCandidate,
  BoardPackageMatchKind,
} from "@/lib/meeting-v2/match-board-package";
import {
  buildTrimmedBoardPackage,
  type BoardPackageSelection,
} from "@/lib/pdf/board-package";

const BoardPackagePageSelector = dynamic(
  () =>
    import("@/components/BoardPackagePageSelector").then(
      (m) => m.BoardPackagePageSelector,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        Loading board package page picker…
      </div>
    ),
  },
);

function defaultTitleForDate(date: string) {
  return `Minutes - ${date}`;
}

type Stage = 1 | 2 | 3;
type PackageTab = "existing" | "upload";

const STAGES: { id: Stage; label: string }[] = [
  { id: 1, label: "Details" },
  { id: 2, label: "Transcript" },
  { id: 3, label: "Board package" },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function GenerateMeetingV2Dialog({ open, onClose }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptPreviewContent, setTranscriptPreviewContent] = useState<
    string | null
  >(null);
  const [transcriptPreviewLoading, setTranscriptPreviewLoading] = useState(false);

  const [packageTab, setPackageTab] = useState<PackageTab>("existing");
  const [uploadSelection, setUploadSelection] =
    useState<BoardPackageSelection | null>(null);
  const [existingSelection, setExistingSelection] =
    useState<BoardPackageSelection | null>(null);
  const [packageMatchKind, setPackageMatchKind] =
    useState<BoardPackageMatchKind>("none");
  const [packageCandidates, setPackageCandidates] = useState<
    BoardPackageCandidate[]
  >([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [existingPdfFile, setExistingPdfFile] = useState<File | null>(null);
  const [existingPdfLoading, setExistingPdfLoading] = useState(false);
  const [packagePdfEnabled, setPackagePdfEnabled] = useState(false);
  const loadedPdfIdRef = useRef<string | null>(null);

  const handleUploadSelection = useCallback(
    (value: BoardPackageSelection | null) => {
      setUploadSelection(value);
    },
    [],
  );

  const handleExistingSelection = useCallback(
    (value: BoardPackageSelection | null) => {
      setExistingSelection(value);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  useEffect(() => {
    if (!transcriptFile) {
      setTranscriptPreviewContent(null);
      setTranscriptPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setTranscriptPreviewLoading(true);

    void transcriptFile
      .text()
      .then((content) => {
        if (cancelled) return;
        setTranscriptPreviewContent(content);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setTranscriptPreviewContent(null);
        setError("Could not read the selected transcript file.");
      })
      .finally(() => {
        if (!cancelled) setTranscriptPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transcriptFile]);

  useEffect(() => {
    if (!open || !meetingDate) return;

    const controller = new AbortController();
    setPackagesLoading(true);

    void fetch(
      `/api/v2/meetings/board-packages?meetingDate=${encodeURIComponent(meetingDate)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          selectedId?: string | null;
          matchKind?: BoardPackageMatchKind;
          ranked?: BoardPackageCandidate[];
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load board packages.");
        }
        setPackageMatchKind(payload.matchKind ?? "none");
        setPackageCandidates(payload.ranked ?? []);
        setSelectedPackageId(payload.selectedId ?? null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setPackageMatchKind("none");
        setPackageCandidates([]);
        setSelectedPackageId(null);
        setError(
          e instanceof Error ? e.message : "Could not load board packages.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPackagesLoading(false);
      });

    return () => controller.abort();
  }, [meetingDate, open]);

  const selectedPackageName = packageCandidates.find(
    (item) => item.id === selectedPackageId,
  )?.filename;

  useEffect(() => {
    if (!packagePdfEnabled) return;
    if (!selectedPackageId || !selectedPackageName) {
      loadedPdfIdRef.current = null;
      setExistingPdfFile(null);
      return;
    }
    if (loadedPdfIdRef.current === selectedPackageId) {
      return;
    }

    const controller = new AbortController();
    const requestId = selectedPackageId;
    setExistingPdfLoading(true);
    setExistingPdfFile(null);

    void fetch(`/api/email/attachments/${requestId}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not download the board package on file.");
        }
        const blob = await response.blob();
        return new File([blob], selectedPackageName, {
          type: "application/pdf",
        });
      })
      .then((file) => {
        if (controller.signal.aborted) return;
        loadedPdfIdRef.current = requestId;
        setExistingPdfFile(file);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        loadedPdfIdRef.current = null;
        setExistingPdfFile(null);
        setError(
          e instanceof Error
            ? e.message
            : "Could not download the board package on file.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setExistingPdfLoading(false);
      });

    return () => controller.abort();
  }, [packagePdfEnabled, selectedPackageId, selectedPackageName]);

  function resetForm() {
    setStage(1);
    setLoading(false);
    setError(null);
    setTitle("");
    setAutoTitle(null);
    setMeetingDate("");
    setFormKey((key) => key + 1);
    setTranscriptFile(null);
    setTranscriptPreviewContent(null);
    setTranscriptPreviewLoading(false);
    setPackageTab("existing");
    setUploadSelection(null);
    setExistingSelection(null);
    setPackageMatchKind("none");
    setPackageCandidates([]);
    setSelectedPackageId(null);
    setPackagesLoading(false);
    setExistingPdfFile(null);
    setExistingPdfLoading(false);
    setPackagePdfEnabled(false);
    loadedPdfIdRef.current = null;
  }

  function handleClose() {
    if (loading) return;
    resetForm();
    onClose();
  }

  function handleMeetingDateChange(date: string) {
    setMeetingDate(date);
    if (!date) return;

    const nextTitle = defaultTitleForDate(date);
    setTitle((current) =>
      current === "" || current === autoTitle ? nextTitle : current,
    );
    setAutoTitle(nextTitle);
  }

  function stageOneValid() {
    return title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate);
  }

  function stageTwoValid() {
    return Boolean(transcriptFile?.name.toLowerCase().endsWith(".vtt"));
  }

  function activePackageSelection() {
    return packageTab === "existing" ? existingSelection : uploadSelection;
  }

  function canOpenStage(next: Stage) {
    if (next === 1) return true;
    if (next === 2) return stageOneValid();
    return stageOneValid() && stageTwoValid();
  }

  function validateStage(current: Stage): string | null {
    if (current === 1 && !stageOneValid()) {
      return "Enter a meeting title and date.";
    }
    if (current === 2 && !stageTwoValid()) {
      return "Upload a Teams transcript (.vtt).";
    }
    return null;
  }

  function goToStage(next: Stage) {
    if (next === stage) return;
    if (next > stage) {
      for (let current = 1; current < next; current += 1) {
        const message = validateStage(current as Stage);
        if (message) {
          setError(message);
          return;
        }
      }
    }
    if (!canOpenStage(next)) return;
    setError(null);
    setStage(next);
    if (next === 3) setPackagePdfEnabled(true);
  }

  async function submit() {
    setError(null);

    const packageSelection = activePackageSelection();
    if (!packageSelection || packageSelection.selectedPages.length === 0) {
      setError("Select at least one page from the board package PDF.");
      return;
    }
    if (!transcriptFile) {
      setError("Upload a Teams transcript (.vtt).");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("meetingDate", meetingDate);
    formData.append("transcript", transcriptFile);

    try {
      const trimmed = await buildTrimmedBoardPackage(packageSelection);
      formData.append("boardPackage", trimmed);
    } catch (e) {
      setLoading(false);
      setError(
        e instanceof Error ? e.message : "Could not trim board package PDF.",
      );
      return;
    }

    try {
      const response = await fetch("/api/v2/meetings/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Could not start the V2 meeting pipeline.",
        );
      }

      const payload = (await response.json()) as { id: string };
      sessionStorage.setItem(`meeting-v2-fresh:${payload.id}`, "1");
      onClose();
      router.push(`/operations/meetings/v2/${payload.id}`);
      resetForm();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unexpected server error.",
      );
      setLoading(false);
    }
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage < 3) {
      goToStage((stage + 1) as Stage);
      return;
    }
    void submit();
  }

  if (!open) return null;

  const selectedCandidate = packageCandidates.find(
    (item) => item.id === selectedPackageId,
  );
  const packageStatus =
    packageMatchKind === "exact"
      ? `Matched the package dated ${meetingDate}.`
      : packageMatchKind === "nearest" && selectedCandidate
        ? `No exact date match. Closest package is ${selectedCandidate.parsedDate ?? "undated"}.`
        : packagesLoading
          ? "Looking up packages already on file…"
          : "No board package on file matched this meeting date.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={handleClose}
        disabled={loading}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-meeting-v2-dialog-title"
        className="relative flex h-[min(90vh,860px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Meetings V2
          </p>
          <h2
            id="generate-meeting-v2-dialog-title"
            className="mt-1 text-xl font-semibold text-slate-900"
          >
            Create V2 workspace
          </h2>
          <ol
            className="mt-4 flex w-full list-none items-center p-0"
            aria-label="Create steps"
          >
            {STAGES.map((item, index) => {
              const current = item.id === stage;
              const reachable = canOpenStage(item.id);
              const stepControl = (
                <button
                  type="button"
                  disabled={loading || !reachable}
                  aria-current={current ? "step" : undefined}
                  onClick={() => goToStage(item.id)}
                  className={`flex items-center gap-2 rounded-full px-2 py-1 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    current
                      ? "text-teal-800"
                      : reachable
                        ? "text-slate-600 hover:text-slate-900"
                        : "text-slate-400"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      current
                        ? "bg-teal-600 text-white"
                        : reachable
                          ? "bg-slate-200 text-slate-700"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {item.id}
                  </span>
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );

              if (index === 0) {
                return (
                  <li key={item.id} className="shrink-0">
                    {stepControl}
                  </li>
                );
              }

              return (
                <Fragment key={item.id}>
                  <li
                    className="mx-2 h-px min-w-4 flex-1 list-none bg-slate-200"
                    aria-hidden
                  />
                  <li className="shrink-0">{stepControl}</li>
                </Fragment>
              );
            })}
          </ol>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleFormSubmit}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overflow-anchor-none px-6 py-5">
            <div className={stage === 1 ? "flex min-h-full flex-col" : "hidden"}>
                <p className="text-sm text-slate-600">
                  Name the meeting first. The date is used to find the board
                  package already on file.
                </p>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      className="text-sm font-semibold text-slate-800"
                      htmlFor="generate-v2-title"
                    >
                      Meeting title *
                    </label>
                    <input
                      id="generate-v2-title"
                      name="title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      className="text-sm font-semibold text-slate-800"
                      htmlFor="generate-v2-meeting-date"
                    >
                      Meeting date *
                    </label>
                    <input
                      id="generate-v2-meeting-date"
                      name="meetingDate"
                      type="date"
                      value={meetingDate}
                      onChange={(event) =>
                        handleMeetingDateChange(event.target.value)
                      }
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>
                <div className="mt-6 flex-1 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70" />
            </div>

            <div
              className={
                stage === 2 ? "flex min-h-full flex-col gap-3" : "hidden"
              }
            >
              <p className="text-sm text-slate-600">
                Upload the Teams transcript. The preview below uses the same
                Readable and Raw VTT views as elsewhere in the app.
              </p>
              <FileDropzone
                key={formKey}
                compact
                name="transcript"
                label="Teams transcript (.vtt)"
                accept=".vtt,text/vtt"
                required={false}
                hint="Required. Used as the factual transcript source."
                onFileChange={setTranscriptFile}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {transcriptPreviewLoading ? (
                  <p className="p-4 text-sm text-slate-600">
                    Reading transcript…
                  </p>
                ) : transcriptPreviewContent ? (
                  <VttViewerDialog
                    embedded
                    embeddedFill
                    open
                    vttContent={transcriptPreviewContent}
                    localFileName={transcriptFile?.name}
                    fileLabel={transcriptFile?.name ?? "transcript.vtt"}
                    onClose={() => {}}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
                    Select a .vtt file to preview the transcript here.
                  </div>
                )}
              </div>
            </div>

            <div className={stage === 3 ? "space-y-3" : "hidden"}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  {packageTab === "existing" ? (
                    packageCandidates.length > 0 ? (
                      <div className="space-y-1">
                        <select
                          aria-label="Board package on file"
                          value={selectedPackageId ?? ""}
                          onChange={(event) =>
                            setSelectedPackageId(event.target.value || null)
                          }
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          <option value="">Select a package…</option>
                          {packageCandidates.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.filename}
                              {item.parsedDate ? ` · ${item.parsedDate}` : ""}
                              {` · received ${formatDateTime(item.receivedAt)}`}
                            </option>
                          ))}
                        </select>
                        {packageMatchKind !== "exact" ? (
                          <p className="text-xs text-slate-500">
                            {packageStatus}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">{packageStatus}</p>
                    )
                  ) : null}
                </div>
                <div
                  className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                  role="tablist"
                  aria-label="Board package source"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={packageTab === "existing"}
                    onClick={() => setPackageTab("existing")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      packageTab === "existing"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    On file
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={packageTab === "upload"}
                    onClick={() => setPackageTab("upload")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      packageTab === "upload"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Upload new
                  </button>
                </div>
              </div>

              <div className={packageTab === "existing" ? "space-y-3" : "hidden"}>
                {existingPdfLoading ? (
                  <p className="text-sm text-slate-600">
                    Loading the selected package…
                  </p>
                ) : null}
                <BoardPackagePageSelector
                  label="Management report pages *"
                  showFilePicker={false}
                  previewFitWidth
                  externalFile={existingPdfFile}
                  onSelectionChange={handleExistingSelection}
                  disabled={loading || existingPdfLoading}
                />
              </div>

              <div className={packageTab === "upload" ? "space-y-3" : "hidden"}>
                <BoardPackagePageSelector
                  label="Board package *"
                  previewFitWidth
                  onSelectionChange={handleUploadSelection}
                  disabled={loading}
                />
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <div className="flex items-center gap-3">
              {stage > 1 ? (
                <button
                  type="button"
                  onClick={() => goToStage((stage - 1) as Stage)}
                  disabled={loading}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
              ) : null}
              {stage < 3 ? (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Starting..." : "Create V2 Workspace"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
