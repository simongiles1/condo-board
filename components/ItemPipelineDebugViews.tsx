"use client";

import { useMemo, useState } from "react";

import { ReadableTranscriptView } from "@/components/ReadableTranscriptView";
import type { EvidenceSource, FactResolution } from "@/lib/meeting-v2/evidence-contract";
import type { InvestigationDocument } from "@/lib/meeting-v2/investigation-contract";
import {
  ITEM_DEBUG_STEPS,
  type ItemDebugStep,
  type ItemDebugStepKey,
} from "@/lib/meeting-v2/item-debug-models";
import type { MergedVttCue } from "@/lib/parsers/vtt";

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            active === tab.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function transcriptCuesFromPayload(
  value: unknown,
): MergedVttCue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const cue = entry as Record<string, unknown>;
      const text = String(cue.text ?? "").trim();
      if (!text) return null;
      return {
        start: String(cue.startTimestamp ?? cue.start ?? "00:00:00.000"),
        end: String(cue.endTimestamp ?? cue.end ?? cue.startTimestamp ?? "00:00:00.000"),
        speaker: String(cue.speakerLabel ?? cue.speaker ?? "Unknown"),
        text,
      } satisfies MergedVttCue;
    })
    .filter((cue): cue is MergedVttCue => cue !== null);
}

function partitionEvidenceSources(sources: EvidenceSource[]): {
  transcript: EvidenceSource[];
  board: EvidenceSource[];
  user: EvidenceSource[];
} {
  return {
    transcript: sources.filter((source) => source.kind === "transcript"),
    board: sources.filter((source) => source.kind === "document"),
    user: sources.filter((source) => source.kind === "user"),
  };
}

type PackagePage = {
  pageNumber: number;
  pageHeading: string | null;
  extractedText: string;
};

function parsePackagePages(value: unknown): PackagePage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const rec = entry as Record<string, unknown>;
      const text = String(rec.extractedText ?? "").trim();
      return {
        pageNumber: Number(rec.pageNumber ?? 0),
        pageHeading: rec.pageHeading ? String(rec.pageHeading) : null,
        extractedText: text,
      };
    })
    .filter((entry): entry is PackagePage => Boolean(entry && (entry.extractedText || entry.pageNumber > 0)));
}

function BoardPackageMetadataPanel({
  agendaItem,
  context,
  note,
  packagePages,
  boardSources,
}: {
  agendaItem: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  note: string | null;
  packagePages: PackagePage[];
  boardSources: EvidenceSource[];
}) {
  const sourceText = agendaItem ? String(agendaItem.sourceText ?? "").trim() : "";

  return (
    <div className="space-y-4">
      {note ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </p>
      ) : null}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Agenda Item & Provenance Metadata
        </h4>
        <KeyValueTable
          rows={[
            { label: "Title", value: String(agendaItem?.title ?? "") },
            { label: "Item number", value: String(agendaItem?.itemNumber ?? "") },
            { label: "Type", value: String(agendaItem?.itemType ?? "") },
            { label: "Section", value: String(agendaItem?.sectionLabel ?? "") },
            {
              label: "Source pages",
              value: Array.isArray(agendaItem?.sourcePages)
                ? agendaItem.sourcePages.join(", ")
                : "",
            },
            {
              label: "Transcript ranges",
              value: Array.isArray(context?.sourceTranscriptRanges)
                ? JSON.stringify(context.sourceTranscriptRanges)
                : "",
            },
            ...(Array.isArray(context?.notes) && context.notes.length
              ? [{ label: "Notes", value: context.notes.join("\n") }]
              : []),
            ...(Array.isArray(context?.buildNotes) && context.buildNotes.length
              ? [{ label: "Build notes", value: context.buildNotes.join("\n") }]
              : []),
          ]}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Raw Extracted Package Markdown
          </h4>
          {packagePages.length > 0 ? (
            <span className="text-[11px] font-medium text-slate-500">
              {packagePages.length} {packagePages.length === 1 ? "page" : "pages"} linked
            </span>
          ) : null}
        </div>

        {packagePages.length > 0 ? (
          <div className="space-y-4">
            {packagePages.map((page, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-800">
                    Page {page.pageNumber}
                    {page.pageHeading ? ` — ${page.pageHeading}` : ""}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {page.extractedText.length.toLocaleString()} chars
                  </span>
                </div>
                <div className="max-h-[min(26rem,50vh)] overflow-y-auto p-3">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-800">
                    {page.extractedText}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        ) : boardSources.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Raw page markdown not in this snapshot; displaying document chunks from sources:
            </p>
            <EvidenceSourcesList sources={boardSources} />
          </div>
        ) : sourceText ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h5 className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Extracted summary</h5>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-800">
              {sourceText}
            </pre>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            No extracted package pages or document chunks are associated with this item.
          </p>
        )}
      </div>
    </div>
  );
}

function EvidenceSourcesList({ sources }: { sources: EvidenceSource[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-slate-500">No evidence sources in this payload.</p>;
  }
  return (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li
          key={source.id}
          className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
        >
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">{source.kind}</span>
            <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-800">{source.association}</span>
            <span className="font-mono normal-case text-slate-400">{source.id}</span>
            {source.sequence != null ? (
              <span className="normal-case text-slate-400">cue #{source.sequence}</span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{source.text}</p>
        </li>
      ))}
    </ul>
  );
}

function KeyValueTable({ rows }: { rows: Array<{ label: string; value: string | null | undefined }> }) {
  return (
    <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
          <dt className="font-semibold text-slate-500">{row.label}</dt>
          <dd className="whitespace-pre-wrap text-slate-900">{row.value?.trim() ? row.value : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function FactsResolutionView({ facts }: { facts: FactResolution }) {
  return (
    <div className="space-y-4">
      {facts.facts.length === 0 ? (
        <p className="text-sm text-slate-500">No resolved facts yet.</p>
      ) : (
        <ul className="space-y-3">
          {facts.facts.map((fact, index) => (
            <li key={`${fact.field}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-slate-900">{fact.field}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {fact.scope}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{fact.explanation}</p>
              {fact.candidates.length ? (
                <ul className="mt-2 space-y-1.5">
                  {fact.candidates.map((candidate, candidateIndex) => (
                    <li
                      key={`${candidate.sourceId}-${candidateIndex}`}
                      className={`rounded-lg border px-2.5 py-2 text-xs ${
                        fact.selected === candidateIndex
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="font-semibold text-slate-800">
                        {candidate.value}
                        {fact.selected === candidateIndex ? (
                          <span className="ml-2 text-emerald-700">selected</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-slate-500">{candidate.quote}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {facts.unresolvedQuestions.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Unresolved questions
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {facts.unresolvedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function InvestigationOutputView({ doc }: { doc: InvestigationDocument }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-800">
          Outcome: {doc.outcome}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-800">
          Confidence: {doc.confidence}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-800">
          Visibility: {doc.visibility}
        </span>
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Discussion</h4>
        <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{doc.discussion_summary}</p>
      </div>
      {doc.decisions.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Decisions</h4>
          <ul className="list-disc space-y-1 pl-5 text-slate-800">
            {doc.decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {doc.motion ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Motion</h4>
          <KeyValueTable
            rows={[
              { label: "Moved by", value: doc.motion.moved_by },
              { label: "Seconded by", value: doc.motion.seconded_by },
              { label: "Result", value: doc.motion.result },
              { label: "Resolution", value: doc.motion.resolution_text },
            ]}
          />
        </div>
      ) : null}
      {doc.actions.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</h4>
          <ul className="space-y-2">
            {doc.actions.map((action, index) => (
              <li key={index} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800">
                <span className="font-medium">{action.description}</span>
                {action.owner ? (
                  <span className="text-slate-500"> · {action.owner}</span>
                ) : null}
                {action.due_date ? (
                  <span className="text-slate-500"> · due {action.due_date}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ValidationOutputView({ value }: { value: Record<string, unknown> }) {
  const verdict = String(value.verdict ?? "unknown");
  const tone =
    verdict === "pass"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : verdict === "fail"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-amber-200 bg-amber-50 text-amber-900";
  const issues = Array.isArray(value.issues) ? value.issues : [];
  return (
    <div className="space-y-3 text-sm">
      <p className={`inline-flex rounded-full border px-3 py-1 font-semibold capitalize ${tone}`}>
        Verdict: {verdict.replace(/_/g, " ")}
      </p>
      {typeof value.summary === "string" ? (
        <p className="whitespace-pre-wrap text-slate-800">{value.summary}</p>
      ) : null}
      {issues.length ? (
        <ul className="space-y-2">
          {issues.map((issue, index) => {
            const row = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : {};
            return (
              <li key={index} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="font-semibold text-slate-900">
                  {String(row.severity ?? "issue")}: {String(row.message ?? formatJson(issue))}
                </div>
                {row.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-slate-600">{String(row.detail)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-slate-500">No issues listed.</p>
      )}
    </div>
  );
}

function EvidencePayloadTabs({
  payload,
  rawText,
  onRawChange,
  rawDisabled,
}: {
  payload: Record<string, unknown>;
  rawText: string;
  onRawChange: (value: string) => void;
  rawDisabled: boolean;
}) {
  const tabs = [
    { id: "transcript", label: "Transcript" },
    { id: "board_metadata", label: "Board package & metadata" },
    { id: "sources", label: "Discussion sources" },
    { id: "raw", label: "Raw JSON" },
  ];
  const [active, setActive] = useState("transcript");
  const agendaItem =
    payload.agendaItem && typeof payload.agendaItem === "object"
      ? (payload.agendaItem as Record<string, unknown>)
      : null;
  const context =
    payload.context && typeof payload.context === "object"
      ? (payload.context as Record<string, unknown>)
      : null;
  const sources = Array.isArray(payload.sources) ? (payload.sources as EvidenceSource[]) : [];
  const { transcript: transcriptSources, board: boardSources, user: userSources } =
    partitionEvidenceSources(sources);
  const discussionSources = [...transcriptSources, ...userSources];
  const cues = transcriptCuesFromPayload(payload.transcriptCues);
  const packagePages = parsePackagePages(payload.packagePages);
  const note = typeof payload.note === "string" ? payload.note : null;

  return (
    <>
      <TabBar tabs={tabs} active={active} onChange={setActive} />
      {active === "transcript" ? (
        cues.length ? (
          <div className="max-h-[min(28rem,50vh)] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80">
            <ReadableTranscriptView cues={cues} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">No transcript cues in this payload.</p>
        )
      ) : null}
      {active === "board_metadata" ? (
        <BoardPackageMetadataPanel
          agendaItem={agendaItem}
          context={context}
          note={note}
          packagePages={packagePages}
          boardSources={boardSources}
        />
      ) : null}
      {active === "sources" ? (
        discussionSources.length ? (
          <EvidenceSourcesList sources={discussionSources} />
        ) : (
          <p className="text-sm text-slate-500">No transcript or user clarification sources.</p>
        )
      ) : null}
      {active === "raw" ? (
        <div className="space-y-4">
          <textarea
            className="h-64 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
            value={rawText}
            onChange={(event) => onRawChange(event.target.value)}
            disabled={rawDisabled}
          />
          {context?.assembledContextText ? (
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900">
                Advanced / Token Audit: Flattened Context String
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-xs text-slate-500">
                  This string is compiled from the sources array. Downstream LLM steps receive structured JSON sources directly.
                </p>
                <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-800">
                  {String(context.assembledContextText)}
                </pre>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function FactsRequestTabs({
  payload,
  rawText,
  onRawChange,
  rawDisabled,
}: {
  payload: Record<string, unknown>;
  rawText: string;
  onRawChange: (value: string) => void;
  rawDisabled: boolean;
}) {
  const tabs = [
    { id: "agenda", label: "Agenda" },
    { id: "sources", label: "Sources" },
    { id: "raw", label: "Raw JSON" },
  ];
  const [active, setActive] = useState("agenda");
  const agenda =
    payload.agenda && typeof payload.agenda === "object"
      ? (payload.agenda as Record<string, unknown>)
      : null;
  const sources = Array.isArray(payload.sources) ? (payload.sources as EvidenceSource[]) : [];

  return (
    <>
      <TabBar tabs={tabs} active={active} onChange={setActive} />
      {active === "agenda" && agenda ? (
        <KeyValueTable
          rows={[
            { label: "Title", value: String(agenda.title ?? "") },
            { label: "Item number", value: String(agenda.itemNumber ?? "") },
            { label: "Type", value: String(agenda.itemType ?? "") },
          ]}
        />
      ) : null}
      {active === "sources" ? <EvidenceSourcesList sources={sources} /> : null}
      {active === "raw" ? (
        <textarea
          className="h-64 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
          value={rawText}
          onChange={(event) => onRawChange(event.target.value)}
          disabled={rawDisabled}
        />
      ) : null}
    </>
  );
}

function parseInvestigationPromptSections(text: string): {
  header: string;
  directors: string;
  clarification: string;
  sources: EvidenceSource[];
  facts: FactResolution | null;
} {
  const sourcesMatch = text.match(
    /Prepared evidence[\s\S]*?\n(\[[\s\S]*?\]|\{[\s\S]*?\})\s*\n\s*Additional user clarification/s,
  );
  let sources: EvidenceSource[] = [];
  if (sourcesMatch?.[1]) {
    try {
      const parsed = JSON.parse(sourcesMatch[1]) as unknown;
      if (Array.isArray(parsed)) sources = parsed as EvidenceSource[];
    } catch {
      // keep empty
    }
  }
  const factsMatch = text.match(/Resolved facts[\s\S]*?\n(\{[\s\S]*\})\s*$/);
  let facts: FactResolution | null = null;
  if (factsMatch?.[1]) {
    try {
      facts = JSON.parse(factsMatch[1]) as FactResolution;
    } catch {
      facts = null;
    }
  }
  const headerMatch = text.match(/^Agenda item title:[^\n]*\n(?:Item number:[^\n]*\n)?(?:Item type:[^\n]*\n)?(?:Section label:[^\n]*\n)?/);
  const header = headerMatch?.[0]?.trim() ?? text.split("\n\n")[0] ?? "";
  const directorsBlock = text.match(/Attending Voting Directors:\n([\s\S]*?)\n\nPrepared evidence/)?.[1]?.trim() ?? "";
  const clarification =
    text.match(/Additional user clarification\n([\s\S]*?)\n\nResolved facts/)?.[1]?.trim() ?? "None";
  return { header, directors: directorsBlock, clarification, sources, facts };
}

function InvestigationPromptTabs({
  text,
  onChange,
  disabled,
}: {
  text: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "transcript", label: "Evidence sources" },
    { id: "facts", label: "Resolved facts" },
    { id: "raw", label: "Raw prompt" },
  ];
  const [active, setActive] = useState("overview");
  const sections = useMemo(() => parseInvestigationPromptSections(text), [text]);

  return (
    <>
      <TabBar tabs={tabs} active={active} onChange={setActive} />
      {active === "overview" ? (
        <div className="space-y-3 text-sm">
          <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 font-sans text-slate-800">
            {sections.header}
          </pre>
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attending voting directors
            </h4>
            <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-sans text-slate-800">
              {sections.directors || "—"}
            </pre>
          </div>
          <KeyValueTable rows={[{ label: "User clarification", value: sections.clarification }]} />
        </div>
      ) : null}
      {active === "transcript" ? <EvidenceSourcesList sources={sections.sources} /> : null}
      {active === "facts" ? (
        sections.facts ? (
          <FactsResolutionView facts={sections.facts} />
        ) : (
          <p className="text-sm text-slate-500">No resolved facts block found in this prompt.</p>
        )
      ) : null}
      {active === "raw" ? (
        <textarea
          className="h-64 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}
    </>
  );
}

function ValidationPromptTabs({
  text,
  onChange,
  disabled,
}: {
  text: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const parsed = tryParseJsonObject(text);
  const tabs = parsed
    ? [
        { id: "agenda", label: "Agenda item" },
        { id: "investigation", label: "Investigation" },
        { id: "evidence", label: "Evidence" },
        { id: "facts", label: "Fact resolution" },
        { id: "raw", label: "Raw JSON" },
      ]
    : [
        { id: "note", label: "Note" },
        { id: "raw", label: "Raw JSON" },
      ];
  const [active, setActive] = useState(parsed ? "agenda" : "note");

  return (
    <>
      <TabBar tabs={tabs} active={active} onChange={setActive} />
      {!parsed ? (
        active === "note" ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">{text}</p>
        ) : null
      ) : null}
      {parsed && active === "agenda" ? (
        <KeyValueTable
          rows={Object.entries(
            (parsed.agendaItem as Record<string, unknown> | undefined) ?? {},
          ).map(([label, value]) => ({
            label,
            value: typeof value === "string" ? value : formatJson(value),
          }))}
        />
      ) : null}
      {parsed && active === "investigation" ? (
        typeof parsed.investigation === "object" && parsed.investigation ? (
          <InvestigationOutputView doc={parsed.investigation as InvestigationDocument} />
        ) : (
          <p className="text-sm text-slate-500">No investigation object.</p>
        )
      ) : null}
      {parsed && active === "evidence" ? (
        <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
          {formatJson(parsed.evidence)}
        </pre>
      ) : null}
      {parsed && active === "facts" ? (
        typeof parsed.factResolution === "object" && parsed.factResolution ? (
          <FactsResolutionView facts={parsed.factResolution as FactResolution} />
        ) : (
          <p className="text-sm text-slate-500">No fact resolution payload.</p>
        )
      ) : null}
      {active === "raw" ? (
        <textarea
          className="h-64 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}
    </>
  );
}

export function ItemPipelineDebugPromptPanel({
  stepKey,
  userPrompt,
  onChange,
  disabled,
}: {
  stepKey: ItemDebugStepKey;
  userPrompt: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const parsed = useMemo(() => tryParseJsonObject(userPrompt), [userPrompt]);

  if (stepKey === "evidence" && parsed) {
    return (
      <EvidencePayloadTabs
        payload={parsed}
        rawText={userPrompt}
        onRawChange={onChange}
        rawDisabled={disabled}
      />
    );
  }

  if (stepKey === "facts" && parsed) {
    return (
      <FactsRequestTabs
        payload={parsed}
        rawText={userPrompt}
        onRawChange={onChange}
        rawDisabled={disabled}
      />
    );
  }

  if (stepKey === "investigate") {
    return <InvestigationPromptTabs text={userPrompt} onChange={onChange} disabled={disabled} />;
  }

  if (stepKey === "validate") {
    return <ValidationPromptTabs text={userPrompt} onChange={onChange} disabled={disabled} />;
  }

  if (stepKey === "draft") {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
        {userPrompt || "Draft output is generated from the investigation step."}
      </p>
    );
  }

  return (
    <textarea
      className="h-64 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
      value={userPrompt}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  );
}

export function ItemPipelineDebugOutputPanel({
  stepKey,
  step,
}: {
  stepKey: ItemDebugStepKey;
  step: ItemDebugStep | null;
}) {
  if (!step?.outputText && !step?.parsedOutput) {
    return <p className="text-sm text-slate-500">No output yet. Run this step.</p>;
  }

  if (stepKey === "evidence") {
    const payload =
      (step.parsedOutput as Record<string, unknown> | null) ?? tryParseJsonObject(step.outputText ?? "");
    if (payload) {
      return (
        <EvidencePayloadTabs
          payload={payload}
          rawText={step.outputText ?? formatJson(payload)}
          onRawChange={() => {}}
          rawDisabled
        />
      );
    }
  }

  if (stepKey === "facts" && step.parsedOutput) {
    return <FactsResolutionView facts={step.parsedOutput as FactResolution} />;
  }

  if (stepKey === "investigate" && step.parsedOutput) {
    return <InvestigationOutputView doc={step.parsedOutput as InvestigationDocument} />;
  }

  if (stepKey === "validate" && step.parsedOutput) {
    return (
      <ValidationOutputView
        value={
          step.parsedOutput && typeof step.parsedOutput === "object"
            ? (step.parsedOutput as Record<string, unknown>)
            : {}
        }
      />
    );
  }

  if (stepKey === "draft" && step.outputText) {
    return (
      <div className="prose prose-sm max-w-none rounded-xl border border-slate-200 bg-white p-4 text-slate-800">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{step.outputText}</pre>
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">
      {step.outputText || formatJson(step.parsedOutput)}
    </pre>
  );
}

export function itemDebugStepStatusIcon(status: ItemDebugStep["status"] | undefined): string {
  if (status === "completed") return "✓";
  if (status === "running") return "…";
  if (status === "failed") return "!";
  return "○";
}
