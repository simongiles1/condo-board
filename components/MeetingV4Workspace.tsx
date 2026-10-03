"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AiUsageDialog, AiUsageIconButton } from "@/components/AiUsageDialog";
import { CopyMarkdownButton } from "@/components/CopyMarkdownButton";
import { GoldStandardCompareDialog } from "@/components/GoldStandardCompareDialog";
import { GoldStandardValidationSidePanel } from "@/components/GoldStandardValidationSidePanel";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { MeetingDocumentsDialog, MeetingDocumentsIconButton } from "@/components/MeetingDocumentsDialog";
import { MeetingsV4PromptsDialog, MeetingsV4PromptsIconButton } from "@/components/MeetingsV4PromptsDialog";
import type { AiUsageStageRow } from "@/lib/gemini/usage";
import { headlineValidationScore } from "@/lib/minutes/gold-standard-compare";
import {
  parseStoredGoldStandardValidation,
  validationScoreLabel,
  type GoldStandardValidationResult,
} from "@/lib/minutes/gold-standard-schema";
import {
  buildMeetingsV4DraftUserPayload,
  meetingsV4DraftFullCallMarkdown,
  meetingsV4DraftTranscriptMarkdown,
} from "@/lib/meeting-v4/draft-payload";
import { MEETINGS_V4_DRAFT_PROMPT } from "@/lib/meeting-v4/prompt";
import type { MeetingsV4ItemResult } from "@/lib/meeting-v4/types";
import {
  MEETINGS_V4_WIZARD_STEPS,
  MEETINGS_V4_WIZARD_STEP_QUERY_PARAM,
  parseMeetingsV4WizardStepId,
} from "@/lib/meeting-v4/wizard";
import type { MeetingsV4Workspace } from "@/lib/meeting-v4/workspace";

/**
 * Shows each V4 stage and drafts minutes from the reviewed segmentation.
 */
export function MeetingV4Workspace({ initial }: { initial: MeetingsV4Workspace }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepLabel, setStepLabel] = useState<string | null>(initial.currentStep);
  const [compareOpen, setCompareOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reCompareBusy, setReCompareBusy] = useState(false);
  const [liveValidation, setLiveValidation] = useState<GoldStandardValidationResult | null>(null);
  const [goldFilePath, setGoldFilePath] = useState(initial.goldStandardFilePath);
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [aiUsageOpen, setAiUsageOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [aiUsageStages, setAiUsageStages] = useState<AiUsageStageRow[] | null>(null);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const requested = parseMeetingsV4WizardStepId(searchParams.get(MEETINGS_V4_WIZARD_STEP_QUERY_PARAM));
  const shownId = requested ?? "segmentation";
  const shown = MEETINGS_V4_WIZARD_STEPS.find((step) => step.id === shownId) ?? MEETINGS_V4_WIZARD_STEPS[0];
  const inventory = workspace.inventory;
  const draftItems = workspace.draft?.items ?? [];
  const storedValidation = useMemo(
    () => parseStoredGoldStandardValidation(workspace.goldStandardValidationJson),
    [workspace.goldStandardValidationJson],
  );
  const validation = liveValidation ?? storedValidation;
  const validationScore = validation ? headlineValidationScore(validation) : null;
  const counts = useMemo(() => ({
    spans: inventory.spans.length,
    missing: inventory.missingLeaves.length,
    unassigned: inventory.unassignedCues.length,
    overlaps: inventory.overlappingCues.length,
  }), [inventory]);
  const hasMeetingDocuments = workspace.hasTranscript || workspace.hasBoardPackage;
  const documentsAgendaOverlay = useMemo(
    () =>
      inventory.items.map((item) => ({
        id: item.id,
        title: item.title,
        itemNumber: item.itemNumber,
      })),
    [inventory.items],
  );

  function refreshAiUsage() {
    setAiUsageLoading(true);
    void fetch(`/api/v3/meetings/${workspace.id}/ai-usage`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { stages?: AiUsageStageRow[] };
        setAiUsageStages(payload.stages ?? []);
      })
      .catch(() => undefined)
      .finally(() => setAiUsageLoading(false));
  }

  useEffect(() => {
    if (!aiUsageOpen) return;
    refreshAiUsage();
  }, [aiUsageOpen, workspace.id]);

  function openStep(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(MEETINGS_V4_WIZARD_STEP_QUERY_PARAM, id);
    router.replace(`?${params.toString()}`);
  }

  async function draft() {
    setBusy(true);
    setError(null);
    const poll = window.setInterval(() => {
      void fetch(`/api/v4/meetings/${workspace.id}`)
        .then((response) => response.json())
        .then((payload: { currentStep?: string | null }) => {
          if (payload.currentStep) setStepLabel(payload.currentStep);
        })
        .catch(() => undefined);
    }, 2000);
    try {
      const response = await fetch(`/api/v4/meetings/${workspace.id}/draft`, { method: "POST" });
      const payload = await response.json() as MeetingsV4Workspace & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The draft failed.");
      setWorkspace(payload);
      setStepLabel(payload.currentStep);
      openStep("draft");
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "The draft failed.");
    } finally {
      window.clearInterval(poll);
      setBusy(false);
    }
  }

  function openCompare() {
    if (validationScore !== null) {
      setPanelOpen(true);
      return;
    }
    setCompareOpen(true);
  }

  function handleCompareSuccess(result: GoldStandardValidationResult) {
    setLiveValidation(result);
    setGoldFilePath((current) => current || "stored");
    setCompareOpen(false);
    setPanelOpen(true);
    void fetch(`/api/v4/meetings/${workspace.id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: MeetingsV4Workspace | null) => {
        if (!payload?.goldStandardFilePath) return;
        setGoldFilePath(payload.goldStandardFilePath);
        setWorkspace((current) => ({
          ...current,
          goldStandardFilePath: payload.goldStandardFilePath,
          goldStandardValidationJson: payload.goldStandardValidationJson,
        }));
      })
      .catch(() => undefined);
  }

  async function recompare() {
    if (!goldFilePath) {
      setPanelOpen(false);
      setCompareOpen(true);
      return;
    }
    setReCompareBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("reuseStored", "1");
      formData.set("minutesSource", "v4");
      const response = await fetch(`/api/meetings/${workspace.id}/compare-gold-standard`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null) as { error?: string; validation?: GoldStandardValidationResult } | null;
      if (!response.ok || !payload?.validation) {
        throw new Error(payload?.error || "Re-compare failed.");
      }
      setLiveValidation(payload.validation);
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : "Re-compare failed.");
      setCompareOpen(true);
    } finally {
      setReCompareBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/operations/meetings?v=4" className="text-xs font-medium text-teal-700 hover:text-teal-900">
            V4 meetings
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">{workspace.title}</h1>
          <p className="text-sm text-slate-600">
            {workspace.meetingDate}
            {workspace.goldUpdatedAt ? ` · segmentation reviewed ${workspace.goldUpdatedAt.slice(0, 10)}` : ""}
          </p>
        </div>
        {busy && stepLabel ? <p className="text-sm text-slate-600">{stepLabel}</p> : null}
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist" aria-label="V4 stages">
        {MEETINGS_V4_WIZARD_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={step.id === shown.id}
            onClick={() => openStep(step.id)}
            className={`rounded-md px-3 py-2 text-left text-sm ${
              step.id === shown.id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            {step.title}
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-600">{shown.detail}</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
        {shown.id === "segmentation" ? <Segmentation inventory={inventory} /> : null}
        {shown.id === "inventory" ? <Inventory inventory={inventory} counts={counts} /> : null}
        {shown.id === "draft" ? (
          <Draft
            items={draftItems}
            busy={busy}
            draftedAt={workspace.draft?.draftedAt ?? null}
            onDraft={() => void draft()}
          />
        ) : null}
        {shown.id === "minutes" ? (
          <Minutes
            markdown={workspace.markdown}
            compareLabel={
              validationScore !== null
                ? `Gold standard · ${validationScoreLabel(validationScore)}`
                : "Compare against gold standard"
            }
            onCompare={openCompare}
            hasMeetingDocuments={hasMeetingDocuments}
            onOpenDocuments={() => setDocumentsDialogOpen(true)}
            onOpenAiUsage={() => setAiUsageOpen(true)}
            onOpenPrompts={() => setPromptsOpen(true)}
          />
        ) : null}
      </div>
      <GoldStandardCompareDialog
        open={compareOpen}
        meetingId={workspace.id}
        meetingTitle={`${workspace.meetingDate} · Meetings V4 draft`}
        aiMinutesSourceLabel="Your V4 assembled minutes"
        extraFields={{ minutesSource: "v4" }}
        onClose={() => setCompareOpen(false)}
        onSuccess={(result) => handleCompareSuccess(result)}
      />
      <AiUsageDialog
        open={aiUsageOpen}
        stages={aiUsageStages}
        loading={aiUsageLoading}
        onClose={() => setAiUsageOpen(false)}
      />
      <MeetingDocumentsDialog
        open={documentsDialogOpen}
        meetingId={workspace.id}
        transcriptFileName={workspace.transcriptFileName ?? undefined}
        hasTranscript={workspace.hasTranscript}
        hasBoardPackage={workspace.hasBoardPackage}
        agendaItems={documentsAgendaOverlay}
        onClose={() => setDocumentsDialogOpen(false)}
      />
      <MeetingsV4PromptsDialog open={promptsOpen} onClose={() => setPromptsOpen(false)} />
      <GoldStandardValidationSidePanel
        meeting={
          panelOpen
            ? {
                id: workspace.id,
                title: `${workspace.meetingDate} · V4 vs official minutes`,
                meetingDate: workspace.meetingDate,
                goldStandardFilePath: goldFilePath,
              }
            : null
        }
        validation={panelOpen ? validation : null}
        reCompareBusy={reCompareBusy}
        agendaItems={inventory.items.map((item) => ({
          title: item.title,
          itemNumber: item.itemNumber,
        }))}
        onClose={() => setPanelOpen(false)}
        onReCompare={() => {
          void recompare();
        }}
        onUploadDifferent={() => {
          setPanelOpen(false);
          setCompareOpen(true);
        }}
      />
    </div>
  );
}

function Segmentation({ inventory }: { inventory: MeetingsV4Workspace["inventory"] }) {
  if (inventory.spans.length === 0) {
    return <p className="text-sm text-slate-600">No reviewed spans are stored.</p>;
  }
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th scope="col" className="py-2 pr-3">Item</th>
          <th scope="col" className="py-2 pr-3">Range</th>
          <th scope="col" className="py-2 pr-3">Cues</th>
          <th scope="col" className="py-2 pr-3">Speakers</th>
          <th scope="col" className="py-2">Opening</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {inventory.spans.map((span) => (
          <tr key={`${span.agendaItemId}-${span.startCueIndex}`}>
            <td className="py-2 pr-3 align-top">
              <span className="font-medium text-slate-900">{span.itemNumber || "—"}</span>
              <span className="mt-0.5 block text-slate-700">{span.title}</span>
            </td>
            <td className="py-2 pr-3 align-top tabular-nums text-slate-700">{span.rangeLabel}</td>
            <td className="py-2 pr-3 align-top tabular-nums text-slate-700">{span.cueCount}</td>
            <td className="py-2 pr-3 align-top text-slate-700">{span.speakers}</td>
            <td className="py-2 align-top text-slate-600">{span.opening}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Inventory({
  inventory,
  counts,
}: {
  inventory: MeetingsV4Workspace["inventory"];
  counts: { spans: number; missing: number; unassigned: number; overlaps: number };
}) {
  return (
    <div className="space-y-6 text-sm text-slate-700">
      <p>
        {counts.spans} spans · {counts.missing} leaves without a span · {counts.unassigned} unassigned cues · {counts.overlaps} cues in two items
      </p>
      <section>
        <h2 className="font-medium text-slate-900">Leaves without a reviewed span</h2>
        {inventory.missingLeaves.length === 0 ? <p className="mt-1">None.</p> : (
          <ul className="mt-1 list-disc pl-5">
            {inventory.missingLeaves.map((item) => (
              <li key={item.id}>{item.itemNumber} {item.title}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="font-medium text-slate-900">Later returns</h2>
        <ul className="mt-1 list-disc pl-5">
          {inventory.items.filter((item) => item.returnCount > 0).map((item) => (
            <li key={item.id}>{item.itemNumber} {item.title} · {item.returnCount + 1} spans</li>
          ))}
        </ul>
        {inventory.items.every((item) => item.returnCount === 0) ? <p className="mt-1">None.</p> : null}
      </section>
      <section>
        <h2 className="font-medium text-slate-900">Cues assigned to more than one item</h2>
        {inventory.overlappingCues.length === 0 ? <p className="mt-1">None.</p> : (
          <ul className="mt-1 list-disc pl-5">
            {inventory.overlappingCues.slice(0, 100).map((cue) => (
              <li key={cue.index}>{cue.start} · {cue.itemNumbers.join(", ")}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="font-medium text-slate-900">Unassigned transcript</h2>
        {inventory.unassignedCues.length === 0 ? <p className="mt-1">None.</p> : (
          <ul className="mt-1 space-y-1">
            {inventory.unassignedCues.slice(0, 80).map((cue) => (
              <li key={cue.index}>
                <span className="tabular-nums text-slate-500">{cue.start}</span>
                {cue.speaker ? ` ${cue.speaker}` : ""} — {cue.preview}
              </li>
            ))}
          </ul>
        )}
        {inventory.unassignedCues.length > 80 ? (
          <p className="mt-2 text-slate-500">Showing 80 of {inventory.unassignedCues.length}.</p>
        ) : null}
      </section>
    </div>
  );
}

function Draft({
  items,
  busy,
  draftedAt,
  onDraft,
}: {
  items: MeetingsV4ItemResult[];
  busy: boolean;
  draftedAt: string | null;
  onDraft: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onDraft}
          disabled={busy}
          className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Drafting…" : draftedAt ? "Draft again" : "Draft minutes"}
        </button>
        {draftedAt ? <p className="text-sm text-slate-600">Stored {draftedAt.slice(0, 16).replace("T", " ")}</p> : null}
      </div>
      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-800">Instructions sent with every item</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs">{MEETINGS_V4_DRAFT_PROMPT}</pre>
      </details>
      {items.length === 0 ? <p className="text-sm text-slate-600">No draft is stored yet.</p> : null}
      {items.map((item) => (
        <article key={item.agendaItemId} className="rounded-md border border-slate-200 p-3">
          <h2 className="font-medium text-slate-900">{item.itemNumber} {item.title}</h2>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
            {item.evidenceFit.replaceAll("_", " ")}
            {item.bundle.cues.length ? ` · ${item.bundle.cues.length} cues` : ""}
            {item.error ? ` · ${item.error}` : ""}
          </p>
          <p className="mt-2 text-sm text-slate-800">{item.minutes || "No paragraph stored."}</p>
          {item.findings.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
              {item.findings.map((finding, index) => (
                <li key={`${item.agendaItemId}-${index}`}>
                  <span className="font-medium">{finding.kind.replaceAll("_", " ")}.</span> {finding.text}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-sm text-slate-600">Amount: {item.amount}{item.amountBasis ? ` — ${item.amountBasis}` : ""}</p>
          {item.actions.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {item.actions.map((action, index) => (
                <li key={`${item.agendaItemId}-action-${index}`}>
                  {action.owner ? `${action.owner}: ` : ""}{action.description}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-sm text-slate-600">
            Motion: {item.motion.resolution
              ? `${item.motion.outcome}${item.motion.mover ? ` · ${[item.motion.mover, item.motion.seconder].filter(Boolean).join(", ")}` : ""}`
              : "none"}
          </p>
          {item.motion.resolution ? (
            <p className="mt-1 text-sm text-slate-700">{item.motion.resolution}</p>
          ) : null}
          {item.gaps.length > 0 ? <p className="mt-1 text-sm text-slate-600">Gaps: {item.gaps.join(" ")}</p> : null}
          <details className="mt-2 text-sm text-slate-600">
            <summary className="cursor-pointer">Agenda text and transcript sent</summary>
            <AgendaSentPanel item={item} />
          </details>
        </article>
      ))}
    </div>
  );
}

type AgendaSentTabId = "corrected" | "docling" | "transcript" | "full";

function AgendaSentPanel({ item }: { item: MeetingsV4ItemResult }) {
  const [activeTab, setActiveTab] = useState<AgendaSentTabId>("corrected");
  const correctedMarkdown = item.bundle.agendaTextCorrected?.trim() ?? "";
  const doclingMarkdown = item.bundle.agendaTextDocling?.trim() ?? "";
  const userPayload = useMemo(
    () => buildMeetingsV4DraftUserPayload({
      title: item.title,
      itemNumber: item.itemNumber,
      bundle: item.bundle,
    }),
    [item.title, item.itemNumber, item.bundle],
  );
  const transcriptMarkdown = useMemo(
    () => meetingsV4DraftTranscriptMarkdown(item.bundle.cues),
    [item.bundle.cues],
  );
  const fullCallMarkdown = useMemo(
    () => meetingsV4DraftFullCallMarkdown(MEETINGS_V4_DRAFT_PROMPT, userPayload),
    [userPayload],
  );
  const tabs: Array<{ id: AgendaSentTabId; label: string }> = [
    { id: "corrected", label: "Corrected extract" },
    { id: "docling", label: "Docling extract" },
    { id: "transcript", label: "Transcript" },
    { id: "full", label: "Full LLM call" },
  ];
  const panelBody = (() => {
    switch (activeTab) {
      case "docling":
        return doclingMarkdown || "No Docling text is linked to this item's source pages.";
      case "transcript":
        return transcriptMarkdown;
      case "full":
        return fullCallMarkdown;
      default:
        return correctedMarkdown || "No corrected rewrite is stored for this item's source pages yet.";
    }
  })();
  const copyMarkdown = panelBody;
  const copyJson = activeTab === "full" ? JSON.stringify(userPayload, null, 2) : null;
  const useMarkdownPreview = activeTab === "corrected" || activeTab === "docling";

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-stretch border-b border-slate-200">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Draft input sent to the model">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 px-3 py-2 text-xs font-semibold ${
                activeTab === tab.id
                  ? "border-b-2 border-teal-700 text-teal-900"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center border-l border-slate-200 px-2">
          <CopyMarkdownButton markdown={copyMarkdown} json={copyJson} label="Copy" />
        </div>
      </div>
      <div className="max-h-96 overflow-auto px-3 py-2 text-sm" role="tabpanel">
        {useMarkdownPreview ? (
          <MarkdownPreview>{panelBody}</MarkdownPreview>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800">{panelBody}</pre>
        )}
      </div>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
        {activeTab === "full"
          ? "Full LLM call shows the system instruction and the user JSON message. The agenda field is corrected-first page text; attachments are empty for V4."
          : activeTab === "transcript"
            ? "Transcript lists the reviewed cues sent in the user message for this item."
            : "The draft prompt sends the corrected extract. This meeting's rewrites are used when they exist. Otherwise the text comes from the V3 package on the same meeting date whose pages match. A page with no rewrite yet uses Docling for that page only."}
      </p>
    </div>
  );
}

function Minutes({
  markdown,
  compareLabel,
  onCompare,
  hasMeetingDocuments,
  onOpenDocuments,
  onOpenAiUsage,
  onOpenPrompts,
}: {
  markdown: string | null;
  compareLabel: string;
  onCompare: () => void;
  hasMeetingDocuments: boolean;
  onOpenDocuments: () => void;
  onOpenAiUsage: () => void;
  onOpenPrompts: () => void;
}) {
  if (!markdown) {
    return <p className="text-sm text-slate-600">Draft the minutes to assemble this document. Attendance and the next-meeting line stay blank.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasMeetingDocuments ? (
          <MeetingDocumentsIconButton
            onClick={onOpenDocuments}
            title="Transcript and board package"
          />
        ) : null}
        <AiUsageIconButton onClick={onOpenAiUsage} title="View AI usage and cost" />
        <MeetingsV4PromptsIconButton onClick={onOpenPrompts} title="View V4 pipeline prompts" />
        <CopyMarkdownButton markdown={markdown} label="Copy as Markdown" />
        <button
          type="button"
          onClick={onCompare}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          {compareLabel}
        </button>
      </div>
      <MarkdownPreview>{markdown}</MarkdownPreview>
    </div>
  );
}
