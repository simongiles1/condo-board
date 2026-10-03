"use client";

import { useEffect, useState } from "react";

import { MEETINGS_V4_PIPELINE_PROMPT_TABS } from "@/lib/meeting-v4/pipeline-prompts";

/** Opens the V4 pipeline prompt viewer from a compact header control. */
export function MeetingsV4PromptsIconButton({
  onClick,
  disabled,
  title = "View V4 pipeline prompts",
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
          d="M7.5 8.25h9m-9 3h6m-6 3h4.5M5.25 19.5h13.5a1.5 1.5 0 0 0 1.5-1.5V6.75a1.5 1.5 0 0 0-1.5-1.5H8.25L5.25 6.75v11.25a1.5 1.5 0 0 0 1.5 1.5Z"
        />
      </svg>
    </button>
  );
}

/** Tabbed modal listing prompts and instructions for Meetings V4 stages. */
export function MeetingsV4PromptsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(MEETINGS_V4_PIPELINE_PROMPT_TABS[0]?.id ?? "draft");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const active = MEETINGS_V4_PIPELINE_PROMPT_TABS.find((tab) => tab.id === activeId)
    ?? MEETINGS_V4_PIPELINE_PROMPT_TABS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="v4-prompts-title"
        className="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="v4-prompts-title" className="text-lg font-semibold text-slate-900">
              Meetings V4 prompts
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              System instructions and rules for each pipeline stage. Upstream steps ran before V4 on this meeting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 p-2 sm:w-52 sm:flex-col sm:border-b-0 sm:border-r"
            role="tablist"
            aria-label="Pipeline stages"
          >
            {MEETINGS_V4_PIPELINE_PROMPT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                onClick={() => setActiveId(tab.id)}
                className={`rounded-md px-3 py-2 text-left text-sm ${
                  tab.id === activeId
                    ? "bg-teal-50 font-medium text-teal-900"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="block">{tab.title}</span>
                <span className="block text-xs font-normal text-slate-500">{tab.subtitle}</span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
            {active ? (
              <>
                <h3 className="text-sm font-semibold text-slate-900">{active.title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{active.subtitle}</p>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-800">
                  {active.body}
                </pre>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
