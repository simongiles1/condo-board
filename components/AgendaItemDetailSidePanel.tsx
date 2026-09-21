"use client";

import { useEffect, useId, useRef, useState } from "react";

/** One evidence citation attached to an agenda item. */
export type AgendaItemDetailEvidence = {
  id: string;
  sourceType: "transcript_segment" | "document_page" | "document_section";
  sourceId: string;
  rationale: string | null;
  relevanceScore: number;
  snippet: string | null;
  speakerLabel?: string | null;
  timestamp?: string | null;
  pageNumber?: number | null;
};

/** Agenda item shown in the flags / questions / evidence side panel. */
export type AgendaItemDetail = {
  id: string;
  title: string;
  itemNumber: string | null;
  displayNumber: string;
  depth: number;
  openQuestions: string[];
  validation: Array<{
    severity: string;
    code: string;
    message: string;
  }>;
  evidence?: AgendaItemDetailEvidence[];
};

type DetailTab = "flags" | "questions" | "evidence";

const LEGACY_CLARIFICATION_KEY = "text";

type Props = {
  items: AgendaItemDetail[];
  selectedItemId: string | null;
  initialTab?: DetailTab;
  answers: Record<string, Record<string, string>>;
  dirtyItems: Record<string, boolean>;
  busyItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onClose: () => void;
  onAnswerChange: (itemId: string, question: string, value: string) => void;
  onSubmit: (itemId: string) => void;
};

function severityTone(severity: string): string {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function extraClarificationKeys(item: AgendaItemDetail, itemAnswers: Record<string, string>): string[] {
  const questionSet = new Set(item.openQuestions);
  return Object.keys(itemAnswers).filter((key) => {
    if (questionSet.has(key)) return false;
    return Boolean(itemAnswers[key]?.trim());
  });
}

function DetailTabStrip({
  active,
  onChange,
  flagCount,
  questionCount,
  evidenceCount,
}: {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
  flagCount: number;
  questionCount: number;
  evidenceCount: number;
}) {
  const tabs: { id: DetailTab; label: string; count: number }[] = [
    { id: "flags", label: "Flags", count: flagCount },
    { id: "questions", label: "Questions", count: questionCount },
    { id: "evidence", label: "Evidence & Provenance", count: evidenceCount },
  ];

  return (
    <div
      className="flex shrink-0 gap-1 border-b border-slate-200 px-5"
      role="tablist"
      aria-label="Agenda item detail sections"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              selected
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            {tab.count > 0 ? (
              <span className="ml-1.5 text-xs font-medium text-slate-500">({tab.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function FlagsTabContent({ item }: { item: AgendaItemDetail }) {
  const flags = item.validation.filter(
    (validation) => validation.severity === "error" || validation.severity === "warning",
  );

  if (flags.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        This item currently has no validation flags.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {flags.map((validation) => (
        <div
          key={`${item.id}-${validation.code}`}
          className={`rounded-2xl border px-4 py-3 text-sm ${severityTone(validation.severity)}`}
        >
          <div className="font-medium">{validation.message}</div>
        </div>
      ))}
    </div>
  );
}

function QuestionsTabContent({
  item,
  itemAnswers,
  dirty,
  busy,
  onAnswerChange,
  onSubmit,
}: {
  item: AgendaItemDetail;
  itemAnswers: Record<string, string>;
  dirty: boolean;
  busy: boolean;
  onAnswerChange: (question: string, value: string) => void;
  onSubmit: () => void;
}) {
  const extras = extraClarificationKeys(item, itemAnswers);

  if (item.openQuestions.length === 0 && extras.length === 0) {
    return <p className="text-sm text-slate-600">No open questions on this item.</p>;
  }

  return (
    <div className="space-y-5">
      {item.openQuestions.map((question, index) => {
        const fieldId = `question-answer-${item.id}-${index}`;
        return (
          <div key={`${item.id}-question-${index}`} className="space-y-2">
            <label htmlFor={fieldId} className="block text-sm font-medium leading-6 text-slate-800">
              {question}
            </label>
            <textarea
              id={fieldId}
              className="min-h-24 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              placeholder="Answer this question for the next investigation pass..."
              value={itemAnswers[question] ?? ""}
              onChange={(event) => onAnswerChange(question, event.target.value)}
            />
          </div>
        );
      })}

      {extras.map((key) => {
        const fieldId = `question-extra-${item.id}-${key}`;
        const label = key === LEGACY_CLARIFICATION_KEY ? "Additional clarification" : key;
        return (
          <div key={fieldId} className="space-y-2">
            <label htmlFor={fieldId} className="block text-sm font-medium leading-6 text-slate-800">
              {label}
            </label>
            <textarea
              id={fieldId}
              className="min-h-24 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              value={itemAnswers[key] ?? ""}
              onChange={(event) => onAnswerChange(key, event.target.value)}
            />
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          className="inline-flex items-center rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onSubmit}
          type="button"
        >
          {busy ? "Submitting..." : "Submit & Re-evaluate"}
        </button>
        {dirty ? <span className="text-xs text-slate-500">Unsaved answers</span> : null}
      </div>
    </div>
  );
}

function EvidenceTabContent({ item }: { item: AgendaItemDetail }) {
  const evidence = item.evidence ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Auditable pipeline trace showing verbatim excerpts and locations from the meeting transcript
          and board package.
        </p>
        {evidence.length > 0 ? (
          <div className="flex items-center gap-2">
            {(() => {
              const hasTranscript = evidence.some((entry) => entry.sourceType === "transcript_segment");
              const hasDoc = evidence.some(
                (entry) =>
                  entry.sourceType === "document_page" || entry.sourceType === "document_section",
              );
              if (hasTranscript && hasDoc) {
                return (
                  <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-800">
                    Hybrid (Transcript + Board Package)
                  </span>
                );
              }
              if (hasTranscript) {
                return (
                  <span className="rounded-full border border-purple-300 bg-purple-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-800">
                    Transcript Derived
                  </span>
                );
              }
              return (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                  Board Package Only
                </span>
              );
            })()}
          </div>
        ) : null}
      </div>

      {evidence.length > 0 ? (
        <div className="space-y-3">
          {evidence.map((ev) => {
            const isTranscript = ev.sourceType === "transcript_segment";
            const isDocPage = ev.sourceType === "document_page";
            return (
              <div
                key={ev.id}
                className={`rounded-2xl border p-4 text-sm transition ${
                  isTranscript
                    ? "border-purple-200 bg-purple-50/50"
                    : isDocPage
                      ? "border-blue-200 bg-blue-50/50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                        isTranscript
                          ? "bg-purple-200 text-purple-900"
                          : isDocPage
                            ? "bg-blue-200 text-blue-900"
                            : "bg-slate-200 text-slate-800"
                      }`}
                    >
                      {isTranscript ? "Transcript" : isDocPage ? "Board Package" : "Agenda Section"}
                    </span>

                    {isTranscript ? (
                      <span className="font-medium text-slate-800">
                        {ev.speakerLabel ? `${ev.speakerLabel}` : "Speaker"}
                        {ev.timestamp ? (
                          <span className="ml-1.5 font-mono text-xs text-slate-500">
                            ({ev.timestamp.slice(0, 8)})
                          </span>
                        ) : null}
                      </span>
                    ) : isDocPage && ev.pageNumber ? (
                      <span className="font-semibold text-slate-800">Page {ev.pageNumber}</span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Score: {ev.relevanceScore}</span>
                  </div>
                </div>

                {ev.rationale ? (
                  <p className="mb-2 text-xs italic text-slate-500">Provenance: {ev.rationale}</p>
                ) : null}

                {ev.snippet ? (
                  <blockquote
                    className={`whitespace-pre-wrap rounded-xl border-l-4 py-1.5 pl-3 text-xs font-mono leading-relaxed ${
                      isTranscript
                        ? "border-purple-400 bg-purple-100/50 text-purple-950"
                        : "border-blue-400 bg-blue-100/50 text-blue-950"
                    }`}
                  >
                    {ev.snippet}
                  </blockquote>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs italic text-slate-500">
          No individual evidence citations linked to this agenda item yet.
        </p>
      )}
    </div>
  );
}

function AgendaItemPicker({
  items,
  selectedItemId,
  onSelectItem,
}: {
  items: AgendaItemDetail[];
  selectedItemId: string;
  onSelectItem: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = items.find((item) => item.id === selectedItemId) ?? items[0];

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!selected) return null;

  return (
    <div ref={rootRef} className="relative mt-2">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-teal-300"
      >
        <span className="min-w-0">
          <span className="block font-medium text-slate-900">
            {selected.displayNumber}. {selected.title}
          </span>
          {selected.openQuestions.length > 0 ? (
            <span className="mt-0.5 block text-xs text-amber-800">
              {selected.openQuestions.length}{" "}
              {selected.openQuestions.length === 1 ? "question" : "questions"}
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-slate-500">No open questions</span>
          )}
        </span>
        <span className="mt-0.5 text-slate-400" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Agenda items"
          className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => {
            const selectable = item.openQuestions.length > 0;
            const isSelected = item.id === selectedItemId;
            return (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!selectable}
                  onClick={() => {
                    onSelectItem(item.id);
                    setOpen(false);
                  }}
                  style={{ paddingLeft: `${12 + item.depth * 16}px` }}
                  className={`flex w-full items-start justify-between gap-3 py-1.5 pr-3 text-left text-sm ${
                    isSelected ? "bg-teal-50 text-teal-950" : ""
                  } ${
                    selectable
                      ? "text-slate-800 hover:bg-slate-50"
                      : "cursor-not-allowed text-slate-400"
                  }`}
                >
                  <span className="min-w-0 leading-5">
                    <span className="font-medium tabular-nums">{item.displayNumber}.</span>{" "}
                    {item.title}
                  </span>
                  {item.openQuestions.length > 0 ? (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-900">
                      {item.openQuestions.length}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-slate-400">0</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Side panel for flags, per-question answers, and evidence on one agenda item.
 */
export function AgendaItemDetailSidePanel({
  items,
  selectedItemId,
  initialTab,
  answers,
  dirtyItems,
  busyItemId,
  onSelectItem,
  onClose,
  onAnswerChange,
  onSubmit,
}: Props) {
  const [activeTab, setActiveTab] = useState<DetailTab>("questions");
  const item = items.find((entry) => entry.id === selectedItemId) ?? null;

  useEffect(() => {
    if (!selectedItemId) return;
    setActiveTab(initialTab ?? "questions");
  }, [selectedItemId, initialTab]);

  useEffect(() => {
    if (!item) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const flagCount = item.validation.filter(
    (validation) => validation.severity === "error" || validation.severity === "warning",
  ).length;
  const questionCount = item.openQuestions.length;
  const evidenceCount = item.evidence?.length ?? 0;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close agenda item details"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-item-detail-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="agenda-item-detail-title" className="text-lg font-semibold text-slate-900">
              Agenda item details
            </h2>
            <AgendaItemPicker items={items} selectedItemId={item.id} onSelectItem={onSelectItem} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <DetailTabStrip
          active={activeTab}
          onChange={setActiveTab}
          flagCount={flagCount}
          questionCount={questionCount}
          evidenceCount={evidenceCount}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === "flags" ? <FlagsTabContent item={item} /> : null}
          {activeTab === "questions" ? (
            <QuestionsTabContent
              item={item}
              itemAnswers={answers[item.id] ?? {}}
              dirty={Boolean(dirtyItems[item.id])}
              busy={busyItemId === item.id}
              onAnswerChange={(question, value) => onAnswerChange(item.id, question, value)}
              onSubmit={() => onSubmit(item.id)}
            />
          ) : null}
          {activeTab === "evidence" ? <EvidenceTabContent item={item} /> : null}
        </div>
      </aside>
    </>
  );
}
