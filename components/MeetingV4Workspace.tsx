"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
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
  const requested = parseMeetingsV4WizardStepId(searchParams.get(MEETINGS_V4_WIZARD_STEP_QUERY_PARAM));
  const shownId = requested ?? "segmentation";
  const shown = MEETINGS_V4_WIZARD_STEPS.find((step) => step.id === shownId) ?? MEETINGS_V4_WIZARD_STEPS[0];
  const inventory = workspace.inventory;
  const draftItems = workspace.draft?.items ?? [];
  const counts = useMemo(() => ({
    spans: inventory.spans.length,
    missing: inventory.missingLeaves.length,
    unassigned: inventory.unassignedCues.length,
    overlaps: inventory.overlappingCues.length,
  }), [inventory]);

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
        {shown.id === "minutes" ? <Minutes markdown={workspace.markdown} /> : null}
      </div>
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
            <p className="mt-2 whitespace-pre-wrap">{item.bundle.agendaText}</p>
            <ul className="mt-2 space-y-1">
              {item.bundle.cues.map((cue) => (
                <li key={cue.index}>
                  <span className="tabular-nums text-slate-500">{cue.start}</span>
                  {cue.speaker ? ` ${cue.speaker}` : ""} — {cue.text}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </div>
  );
}

function Minutes({ markdown }: { markdown: string | null }) {
  if (!markdown) {
    return <p className="text-sm text-slate-600">Draft the minutes to assemble this document. Attendance and the next-meeting line stay blank.</p>;
  }
  return <MarkdownPreview>{markdown}</MarkdownPreview>;
}
