"use client";

import { useEffect, useRef, useState } from "react";

import { BoardPackageViewerDialog } from "@/components/BoardPackageViewerDialog";
import { VttViewerDialog } from "@/components/VttViewerDialog";

type DocTab = "transcript" | "boardPackage";

type AgendaOverlayItem = {
  id: string;
  title: string;
  itemNumber: string | null;
  sourceText?: string | null;
};

type Props = {
  open: boolean;
  meetingId: string;
  transcriptFileName?: string;
  hasTranscript: boolean;
  hasBoardPackage: boolean;
  initialTab?: DocTab;
  agendaItems?: AgendaOverlayItem[];
  onClose: () => void;
};

/** Opens the meeting documents dialog from a compact header control. */
export function MeetingDocumentsIconButton({
  onClick,
  disabled,
  title = "Meeting documents",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-4 w-4"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 4.5h8l3 3v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
        />
        <path strokeLinecap="round" d="M16 4.5v3h3M9 12h6M9 15.5h4.5" />
      </svg>
    </button>
  );
}

export function MeetingDocumentsDialog({
  open,
  meetingId,
  transcriptFileName,
  hasTranscript,
  hasBoardPackage,
  initialTab,
  agendaItems,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<DocTab>(
    initialTab ?? (hasTranscript ? "transcript" : "boardPackage"),
  );
  const tabInitializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      tabInitializedRef.current = false;
      return;
    }
    if (tabInitializedRef.current) return;
    tabInitializedRef.current = true;
    setActiveTab(initialTab ?? (hasTranscript ? "transcript" : "boardPackage"));
  }, [open, initialTab, hasTranscript, hasBoardPackage]);

  if (!open) return null;

  const showTranscript = activeTab === "transcript" && hasTranscript;
  const showBoardPackage = activeTab === "boardPackage" && hasBoardPackage;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-documents-title"
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="meeting-documents-title" className="text-lg font-semibold text-slate-900">
              Meeting Documents
            </h2>
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
              role="tablist"
              aria-label="Document type"
            >
              {hasTranscript ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "transcript"}
                  onClick={() => setActiveTab("transcript")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === "transcript"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Transcript
                </button>
              ) : null}
              {hasBoardPackage ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "boardPackage"}
                  onClick={() => setActiveTab("boardPackage")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === "boardPackage"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Board Package
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!hasTranscript && !hasBoardPackage ? (
            <p className="px-4 py-6 text-sm text-slate-600">No meeting documents on file.</p>
          ) : showTranscript ? (
            <VttViewerDialog
              open
              embedded
              meetingId={meetingId}
              fileLabel={transcriptFileName ?? "transcript.vtt"}
              agendaItems={agendaItems}
              onClose={onClose}
            />
          ) : showBoardPackage ? (
            <BoardPackageViewerDialog open embedded meetingId={meetingId} onClose={onClose} />
          ) : (
            <p className="px-4 py-6 text-sm text-slate-600">
              Select a document tab above.
            </p>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
