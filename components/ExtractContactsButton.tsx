"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import {
  EntityCardsSidePanel,
  type EntityCardEmailOption,
  type EntityCardsPanelKind,
} from "@/components/EntityCardsSidePanel";
import {
  CONTACT_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL,
  getContactHighlightModelMeta,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  CONTACT_HIGHLIGHT_CLASS,
  CONTACT_HIGHLIGHT_LABELS,
  CONTACT_HIGHLIGHT_TYPES,
  extractionHasAny,
  type ContactEntityCard,
  type ContactHighlightExtraction,
  type ContactHighlightType,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  ORG_HIGHLIGHT_MODELS,
  getOrgHighlightModelMeta,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";

type ExtractItemResult = {
  emailId: string;
  extraction: ContactHighlightExtraction;
  skipped?: boolean;
  error?: string;
};

type FingerprintItemResult = {
  emailId: string;
  entityCards: ContactEntityCard[];
  skipped?: boolean;
  error?: string;
};

export type ContactHighlightsByEmailId = Record<
  string,
  ContactHighlightExtraction
>;

export type ContactExtractItem = {
  emailId: string;
  highlightedText: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  /** Authored body for fingerprint pass (this message only). */
  bodyText: string;
  /** Short label for the entity-card email filter. */
  label: string;
};

type Props = {
  items: ContactExtractItem[];
  /** Extractions for the currently selected model/pass row (or null if none / not run). */
  onActiveExtractions: (value: ContactHighlightsByEmailId | null) => void;
  uniqueContentOnly: boolean;
  onUniqueContentOnlyChange: (value: boolean) => void;
};

type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

type TypeCounts = Record<ContactHighlightType, number>;

type PassRun = {
  extractions: ContactHighlightsByEmailId;
  usage: UsageSummary;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: TypeCounts;
  };
};

type FingerprintPassRun = {
  entityCardsByEmailId: Record<string, ContactEntityCard[]>;
  usage: UsageSummary;
  stats: {
    cardCount: number;
    emailsWithCards: number;
    skipped: number;
    failed: number;
  };
};

type FingerprintMergePassRun = {
  entityCards: ContactEntityCard[];
  usage: UsageSummary;
  stats: {
    cardCount: number;
    inputCardCount: number;
  };
  error: string | null;
};

type ModelRun = PassRun & {
  secondPass: PassRun | null;
  thirdPass: FingerprintPassRun | null;
  fourthPass: FingerprintMergePassRun | null;
};

/** Org fingerprint passes only — enough for the entity-cards panel. */
type OrgFingerprintModelRun = {
  thirdPass: {
    entityCardsByEmailId: Record<string, OrgEntityCard[]>;
    stats: { cardCount: number };
  } | null;
  fourthPass: {
    entityCards: OrgEntityCard[];
    stats: { cardCount: number };
  } | null;
};

type ContactPass = 1 | 2 | 3 | 4;

const EMPTY_TYPE_COUNTS: TypeCounts = {
  contact_name: 0,
  phone: 0,
  job_title: 0,
  company_name: 0,
};

function countExtractionTypes(
  extractions: ContactHighlightsByEmailId,
): TypeCounts {
  const counts: TypeCounts = { ...EMPTY_TYPE_COUNTS };
  for (const extraction of Object.values(extractions)) {
    counts.contact_name += extraction.contact_names.length;
    counts.phone += extraction.phones.length;
    counts.job_title += extraction.job_titles.length;
    counts.company_name += extraction.company_names.length;
  }
  return counts;
}

function buildPassRunFromResults(
  results: ExtractItemResult[],
  usage: UsageSummary,
): PassRun {
  const extractions: ContactHighlightsByEmailId = {};
  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of results) {
    extractions[result.emailId] = result.extraction;
    if (result.error) failed += 1;
    else if (result.skipped) skipped += 1;
    else if (extractionHasAny(result.extraction)) extracted += 1;
    else skipped += 1;
  }

  return {
    extractions,
    usage,
    stats: {
      extracted,
      skipped,
      failed,
      typeCounts: countExtractionTypes(extractions),
    },
  };
}

function buildFingerprintPassRunFromResults(
  results: FingerprintItemResult[],
  usage: UsageSummary,
): FingerprintPassRun {
  const entityCardsByEmailId: Record<string, ContactEntityCard[]> = {};
  let cardCount = 0;
  let emailsWithCards = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of results) {
    entityCardsByEmailId[result.emailId] = result.entityCards;
    cardCount += result.entityCards.length;
    if (result.error) failed += 1;
    else if (result.skipped) skipped += 1;
    else if (result.entityCards.length > 0) emailsWithCards += 1;
    else skipped += 1;
  }

  return {
    entityCardsByEmailId,
    usage,
    stats: {
      cardCount,
      emailsWithCards,
      skipped,
      failed,
    },
  };
}

export function ExtractContactsButton({
  items,
  onActiveExtractions,
  uniqueContentOnly,
  onUniqueContentOnlyChange,
}: Props) {
  const [selectedModelId, setSelectedModelId] =
    useState<ContactHighlightModelId>(DEFAULT_CONTACT_HIGHLIGHT_MODEL);
  const [selectedPass, setSelectedPass] = useState<ContactPass>(1);
  const [runsByModel, setRunsByModel] = useState<
    Partial<Record<ContactHighlightModelId, ModelRun>>
  >({});
  const [loadingModelId, setLoadingModelId] =
    useState<ContactHighlightModelId | null>(null);
  const [loadingPass, setLoadingPass] = useState<ContactPass | null>(null);
  const [errorByModel, setErrorByModel] = useState<
    Partial<Record<ContactHighlightModelId, string>>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entityPanelOpen, setEntityPanelOpen] = useState(false);
  const [entityPanelKind, setEntityPanelKind] =
    useState<EntityCardsPanelKind>("contacts");
  const [entityFilterEmailId, setEntityFilterEmailId] = useState<string | null>(
    null,
  );
  const [orgRunsByModel, setOrgRunsByModel] = useState<
    Partial<Record<OrgHighlightModelId, OrgFingerprintModelRun>>
  >({});

  const eligibleCount = items.filter((item) => item.highlightedText.trim()).length;
  const fingerprintEligibleCount = items.filter(
    (item) =>
      item.bodyText.trim() ||
      item.fromAddress.trim() ||
      item.toAddresses.length > 0 ||
      item.ccAddresses.length > 0,
  ).length;
  const emailIds = items.map((item) => item.emailId);
  const emailIdsKey = emailIds.join(",");
  const selectedRun = runsByModel[selectedModelId] ?? null;
  const selectedPassRun =
    selectedPass === 1
      ? selectedRun
      : selectedPass === 2
        ? (selectedRun?.secondPass ?? null)
        : null;
  const selectedFingerprintRun =
    selectedPass === 3 ? (selectedRun?.thirdPass ?? null) : null;
  const selectedMergeRun =
    selectedPass === 4 ? (selectedRun?.fourthPass ?? null) : null;
  const selectedError =
    errorByModel[selectedModelId] ?? loadError ?? null;
  const isLoading = loadingModelId != null;
  const loadingSelected =
    loadingModelId === selectedModelId && loadingPass === selectedPass;
  const canRunSecondPass = selectedRun != null;
  const canRunThirdPass = selectedRun != null;
  const canRunFourthPass = selectedRun?.thirdPass != null;

  const emailOptions: EntityCardEmailOption[] = useMemo(
    () =>
      items.map((item) => ({
        emailId: item.emailId,
        label: item.label,
      })),
    [items],
  );

  const panelEntityCards =
    selectedRun?.thirdPass?.entityCardsByEmailId ??
    {};
  const panelMergedCards = selectedRun?.fourthPass?.entityCards ?? null;
  const entityCardCount =
    panelMergedCards?.length ??
    selectedRun?.thirdPass?.stats.cardCount ??
    0;

  const preferredOrgRun = useMemo(() => {
    for (const modelId of ORG_HIGHLIGHT_MODELS) {
      const run = orgRunsByModel[modelId];
      if (run?.fourthPass?.entityCards && run.fourthPass.entityCards.length > 0) {
        return { modelId, run };
      }
    }
    for (const modelId of ORG_HIGHLIGHT_MODELS) {
      const run = orgRunsByModel[modelId];
      if (
        run?.thirdPass?.entityCardsByEmailId &&
        Object.values(run.thirdPass.entityCardsByEmailId).some(
          (cards) => cards.length > 0,
        )
      ) {
        return { modelId, run };
      }
    }
    for (const modelId of ORG_HIGHLIGHT_MODELS) {
      const run = orgRunsByModel[modelId];
      if (run?.thirdPass || run?.fourthPass) return { modelId, run };
    }
    return null;
  }, [orgRunsByModel]);

  const panelOrgEntityCards =
    preferredOrgRun?.run.thirdPass?.entityCardsByEmailId ?? {};
  const panelOrgMergedCards =
    preferredOrgRun?.run.fourthPass?.entityCards ?? null;
  const orgEntityCardCount =
    panelOrgMergedCards?.length ??
    preferredOrgRun?.run.thirdPass?.stats.cardCount ??
    0;

  const hasAnyFingerprints =
    (panelMergedCards != null && panelMergedCards.length > 0) ||
    Object.values(panelEntityCards).some((cards) => cards.length > 0) ||
    (panelOrgMergedCards != null && panelOrgMergedCards.length > 0) ||
    Object.values(panelOrgEntityCards).some((cards) => cards.length > 0);

  useEffect(() => {
    if (selectedPass === 3 || selectedPass === 4) {
      // Fingerprints / merge do not drive in-body highlight marks.
      onActiveExtractions(null);
      return;
    }
    onActiveExtractions(selectedPassRun?.extractions ?? null);
  }, [selectedModelId, selectedPass, selectedPassRun, onActiveExtractions]);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedRuns() {
      if (emailIds.length === 0) return;
      setLoadError(null);
      try {
        const [contactResponse, orgResponse] = await Promise.all([
          fetch(
            `/api/analysis/extract-contacts?emailIds=${encodeURIComponent(emailIdsKey)}`,
          ),
          fetch(
            `/api/analysis/extract-organizations?emailIds=${encodeURIComponent(emailIdsKey)}`,
          ),
        ]);
        const contactData = (await contactResponse.json()) as {
          runs?: Partial<Record<ContactHighlightModelId, ModelRun>>;
          error?: string;
        };
        const orgData = (await orgResponse.json()) as {
          runs?: Partial<Record<OrgHighlightModelId, OrgFingerprintModelRun>>;
          error?: string;
        };
        if (cancelled) return;
        if (!contactResponse.ok) {
          setLoadError(
            contactData.error || "Could not load saved contact extractions.",
          );
          return;
        }
        if (contactData.runs && Object.keys(contactData.runs).length > 0) {
          setRunsByModel(contactData.runs);
        }
        if (orgResponse.ok && orgData.runs) {
          setOrgRunsByModel(orgData.runs);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Could not load saved contact extractions.",
        );
      }
    }

    void loadSavedRuns();
    return () => {
      cancelled = true;
    };
  }, [emailIdsKey, emailIds.length]);

  function selectRow(modelId: ContactHighlightModelId, pass: ContactPass) {
    setSelectedModelId(modelId);
    setSelectedPass(pass);
  }

  async function runExtractionForSelected() {
    const modelId = selectedModelId;
    const pass = selectedPass;

    if ((pass === 2 || pass === 3 || pass === 4) && !runsByModel[modelId]) {
      setErrorByModel((prev) => ({
        ...prev,
        [modelId]:
          pass === 4
            ? "Run the fingerprint pass before merging."
            : pass === 3
              ? "Run the first pass before the fingerprint pass."
              : "Run the first pass before the second pass.",
      }));
      return;
    }
    if (pass === 4 && !runsByModel[modelId]?.thirdPass) {
      setErrorByModel((prev) => ({
        ...prev,
        [modelId]: "Run the fingerprint (3rd) pass before merging.",
      }));
      return;
    }

    setLoadingModelId(modelId);
    setLoadingPass(pass);
    setErrorByModel((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });

    try {
      const response = await fetch("/api/analysis/extract-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, model: modelId, pass }),
      });
      const data = (await response.json()) as {
        results?: ExtractItemResult[] | FingerprintItemResult[];
        fourthPass?: FingerprintMergePassRun;
        usage?: UsageSummary;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Contact extraction failed.");
      }

      const usage = data.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        modelName: modelId,
      };

      setRunsByModel((prev) => {
        if (pass === 4) {
          const existing = prev[modelId];
          if (!existing) return prev;
          const mergeRun =
            data.fourthPass ??
            ({
              entityCards:
                ((data.results?.[0] as FingerprintItemResult | undefined)
                  ?.entityCards ?? []),
              usage,
              stats: {
                cardCount:
                  ((data.results?.[0] as FingerprintItemResult | undefined)
                    ?.entityCards ?? []).length,
                inputCardCount: 0,
              },
              error: null,
            } satisfies FingerprintMergePassRun);
          return {
            ...prev,
            [modelId]: {
              ...existing,
              fourthPass: mergeRun,
            },
          };
        }
        if (pass === 3) {
          const existing = prev[modelId];
          if (!existing) return prev;
          const fingerprintRun = buildFingerprintPassRunFromResults(
            (data.results ?? []) as FingerprintItemResult[],
            usage,
          );
          return {
            ...prev,
            [modelId]: {
              ...existing,
              thirdPass: fingerprintRun,
              fourthPass: null,
            },
          };
        }
        if (pass === 2) {
          const existing = prev[modelId];
          if (!existing) return prev;
          const passRun = buildPassRunFromResults(
            (data.results ?? []) as ExtractItemResult[],
            usage,
          );
          return {
            ...prev,
            [modelId]: {
              ...existing,
              secondPass: passRun,
              // Re-running pass 2 clears fingerprints + merge server-side.
              thirdPass: null,
              fourthPass: null,
            },
          };
        }
        const passRun = buildPassRunFromResults(
          (data.results ?? []) as ExtractItemResult[],
          usage,
        );
        return {
          ...prev,
          [modelId]: {
            ...passRun,
            secondPass: null,
            thirdPass: null,
            fourthPass: null,
          },
        };
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Contact extraction failed.";
      setErrorByModel((prev) => ({ ...prev, [modelId]: message }));
    } finally {
      setLoadingModelId(null);
      setLoadingPass(null);
    }
  }

  function clearSelectedRun() {
    const modelId = selectedModelId;
    setRunsByModel((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    setSelectedPass(1);
    setEntityPanelOpen(false);
    setErrorByModel((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    void fetch("/api/analysis/extract-contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailIds, model: modelId }),
    }).catch(() => {
      // UI already cleared; persistence failure is non-blocking.
    });
  }

  const extractButtonLabel = (() => {
    if (loadingSelected) {
      if (selectedPass === 4) return "Merging…";
      if (selectedPass === 3) return "Fingerprinting…";
      if (selectedPass === 2) return "Second pass…";
      return "Extracting…";
    }
    if (selectedPass === 4) {
      return selectedMergeRun ? "Re-run merge" : "Run merge";
    }
    if (selectedPass === 3) {
      return selectedFingerprintRun
        ? "Re-run fingerprints"
        : "Run fingerprints";
    }
    if (selectedPass === 2) {
      return selectedPassRun ? "Re-run second pass" : "Run second pass";
    }
    return selectedRun ? "Re-extract selected" : "Extract selected";
  })();

  const extractDisabled =
    isLoading ||
    (selectedPass === 4
      ? !canRunFourthPass
      : selectedPass === 3
        ? fingerprintEligibleCount === 0 || !canRunThirdPass
        : eligibleCount === 0 || (selectedPass === 2 && !canRunSecondPass));

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Contact extraction by model
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={uniqueContentOnly}
              onChange={(event) =>
                onUniqueContentOnlyChange(event.target.checked)
              }
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <span>Show unique content only</span>
          </label>
          <button
            type="button"
            onClick={() => setEntityPanelOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Entity cards
            {hasAnyFingerprints
              ? ` (${entityCardCount + orgEntityCardCount})`
              : ""}
          </button>
          <button
            type="button"
            disabled={extractDisabled}
            onClick={() => void runExtractionForSelected()}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {extractButtonLabel}
          </button>
          {selectedRun ? (
            <button
              type="button"
              disabled={isLoading}
              onClick={clearSelectedRun}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Clear selected
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">
                Model
              </th>
              <th scope="col" className="px-3 py-2">
                Rate (in/out)
              </th>
              {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                <th key={type} scope="col" className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                    <span className={CONTACT_HIGHLIGHT_CLASS[type]}>Aa</span>
                    {CONTACT_HIGHLIGHT_LABELS[type]}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                Cost
              </th>
              <th scope="col" className="px-3 py-2">
                Tokens
              </th>
              <th scope="col" className="px-3 py-2">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {CONTACT_HIGHLIGHT_MODELS.map((modelId) => {
              const meta = getContactHighlightModelMeta(modelId);
              const run = runsByModel[modelId];
              const secondPass = run?.secondPass ?? null;
              const thirdPass = run?.thirdPass ?? null;
              const fourthPass = run?.fourthPass ?? null;
              const error = errorByModel[modelId];
              const firstSelected =
                modelId === selectedModelId && selectedPass === 1;
              const secondSelected =
                modelId === selectedModelId && selectedPass === 2;
              const thirdSelected =
                modelId === selectedModelId && selectedPass === 3;
              const fourthSelected =
                modelId === selectedModelId && selectedPass === 4;
              const firstLoading =
                loadingModelId === modelId && loadingPass === 1;
              const secondLoading =
                loadingModelId === modelId && loadingPass === 2;
              const thirdLoading =
                loadingModelId === modelId && loadingPass === 3;
              const fourthLoading =
                loadingModelId === modelId && loadingPass === 4;
              const secondPassNewCount = secondPass
                ? secondPass.stats.typeCounts.contact_name +
                  secondPass.stats.typeCounts.phone +
                  secondPass.stats.typeCounts.job_title +
                  secondPass.stats.typeCounts.company_name
                : 0;

              return (
                <Fragment key={modelId}>
                  <tr
                    key={`${modelId}-pass1`}
                    tabIndex={0}
                    aria-selected={firstSelected}
                    onClick={() => selectRow(modelId, 1)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRow(modelId, 1);
                      }
                    }}
                    className={[
                      "cursor-pointer transition-colors",
                      firstSelected
                        ? "bg-teal-50 ring-1 ring-inset ring-teal-600"
                        : "hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {meta.label}
                      {firstSelected ? (
                        <span className="ml-2 text-xs font-normal text-teal-800">
                          selected
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">
                      ${meta.inputPerMillion.toFixed(2)} / $
                      {meta.outputPerMillion.toFixed(2)}
                      {meta.chunking ? (
                        <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-slate-500">
                          {meta.chunking.minChars}–{meta.chunking.maxChars} char
                          chunks
                        </span>
                      ) : null}
                    </td>
                    {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className="px-3 py-2.5 tabular-nums text-slate-700"
                      >
                        {run ? run.stats.typeCounts[type] : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {run ? formatCostUsd(run.usage.costUsd) : "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {run
                        ? `${formatTokenCount(run.usage.inputTokens)} / ${formatTokenCount(run.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {firstLoading
                        ? "Running…"
                        : error && !run
                          ? "Failed"
                          : run
                            ? run.stats.failed > 0
                              ? `Done (${run.stats.failed} failed)`
                              : "Done"
                            : "Not run"}
                    </td>
                  </tr>
                  <tr
                    key={`${modelId}-pass2`}
                    tabIndex={run ? 0 : -1}
                    aria-selected={secondSelected}
                    aria-disabled={!run}
                    onClick={() => {
                      if (!run) return;
                      selectRow(modelId, 2);
                    }}
                    onKeyDown={(event) => {
                      if (!run) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRow(modelId, 2);
                      }
                    }}
                    className={[
                      "transition-colors",
                      run ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                      secondSelected
                        ? "bg-teal-50/80 ring-1 ring-inset ring-teal-600"
                        : run
                          ? "bg-slate-50/60 hover:bg-slate-100/80"
                          : "bg-slate-50/40",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2 pl-8 text-slate-700">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {meta.secondPassLabel}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        new finds only
                      </span>
                      {secondSelected ? (
                        <span className="ml-2 text-xs font-normal text-teal-800">
                          selected
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {meta.secondPass.thinking && !meta.firstPass.thinking
                        ? "thinking on"
                        : meta.chunking
                          ? `${meta.chunking.minChars}–${meta.chunking.maxChars} chars`
                          : "same model"}
                    </td>
                    {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className="px-3 py-2 tabular-nums text-slate-700"
                      >
                        {secondPass
                          ? secondPass.stats.typeCounts[type]
                          : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {secondPass
                        ? formatCostUsd(secondPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {secondPass
                        ? `${formatTokenCount(secondPass.usage.inputTokens)} / ${formatTokenCount(secondPass.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {!run
                        ? "Needs 1st pass"
                        : secondLoading
                          ? "Running…"
                          : error && selectedPass === 2 && !secondPass
                            ? "Failed"
                            : secondPass
                              ? secondPass.stats.failed > 0
                                ? `Done (${secondPass.stats.failed} failed)`
                                : secondPassNewCount > 0
                                  ? `Done · ${secondPassNewCount} new`
                                  : "Done · none new"
                              : "Not run"}
                    </td>
                  </tr>
                  <tr
                    key={`${modelId}-pass3`}
                    tabIndex={run ? 0 : -1}
                    aria-selected={thirdSelected}
                    aria-disabled={!run}
                    onClick={() => {
                      if (!run) return;
                      selectRow(modelId, 3);
                    }}
                    onKeyDown={(event) => {
                      if (!run) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRow(modelId, 3);
                      }
                    }}
                    className={[
                      "transition-colors",
                      run ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                      thirdSelected
                        ? "bg-teal-50/80 ring-1 ring-inset ring-teal-600"
                        : run
                          ? "bg-slate-50/40 hover:bg-slate-100/70"
                          : "bg-slate-50/30",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2 pl-8 text-slate-700">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {meta.thirdPassLabel}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        entity cards
                      </span>
                      {thirdSelected ? (
                        <span className="ml-2 text-xs font-normal text-teal-800">
                          selected
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {meta.thirdPass.thinking && !meta.firstPass.thinking
                        ? "thinking on"
                        : "full email"}
                    </td>
                    {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className="px-3 py-2 tabular-nums text-slate-400"
                      >
                        —
                      </td>
                    ))}
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {thirdPass
                        ? formatCostUsd(thirdPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {thirdPass
                        ? `${formatTokenCount(thirdPass.usage.inputTokens)} / ${formatTokenCount(thirdPass.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {!run
                        ? "Needs 1st pass"
                        : thirdLoading
                          ? "Running…"
                          : error && selectedPass === 3 && !thirdPass
                            ? "Failed"
                            : thirdPass
                              ? thirdPass.stats.failed > 0
                                ? `Done (${thirdPass.stats.failed} failed)`
                                : `Done · ${thirdPass.stats.cardCount} card${thirdPass.stats.cardCount === 1 ? "" : "s"}`
                              : "Not run"}
                    </td>
                  </tr>
                  <tr
                    key={`${modelId}-pass4`}
                    tabIndex={thirdPass ? 0 : -1}
                    aria-selected={fourthSelected}
                    aria-disabled={!thirdPass}
                    onClick={() => {
                      if (!thirdPass) return;
                      selectRow(modelId, 4);
                    }}
                    onKeyDown={(event) => {
                      if (!thirdPass) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRow(modelId, 4);
                      }
                    }}
                    className={[
                      "transition-colors",
                      thirdPass
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-60",
                      fourthSelected
                        ? "bg-teal-50/80 ring-1 ring-inset ring-teal-600"
                        : thirdPass
                          ? "bg-slate-50/30 hover:bg-slate-100/60"
                          : "bg-slate-50/20",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2 pl-8 text-slate-700">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {meta.fourthPassLabel}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        unique people
                      </span>
                      {fourthSelected ? (
                        <span className="ml-2 text-xs font-normal text-teal-800">
                          selected
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {meta.fourthPass.thinking && !meta.firstPass.thinking
                        ? "thinking on"
                        : "all cards"}
                    </td>
                    {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className="px-3 py-2 tabular-nums text-slate-400"
                      >
                        —
                      </td>
                    ))}
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {fourthPass
                        ? formatCostUsd(fourthPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {fourthPass
                        ? `${formatTokenCount(fourthPass.usage.inputTokens)} / ${formatTokenCount(fourthPass.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {!thirdPass
                        ? "Needs 3rd pass"
                        : fourthLoading
                          ? "Running…"
                          : error && selectedPass === 4 && !fourthPass
                            ? "Failed"
                            : fourthPass
                              ? fourthPass.error
                                ? "Failed"
                                : fourthPass.stats.inputCardCount > 0
                                  ? `Done · ${fourthPass.stats.inputCardCount}→${fourthPass.stats.cardCount}`
                                  : `Done · ${fourthPass.stats.cardCount} unique`
                              : "Not run"}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedError ? (
        <p className="text-sm text-red-700" role="alert">
          {selectedError}
        </p>
      ) : null}

      {selectedPass === 4 ? (
        selectedMergeRun ? (
          <p className="text-sm text-slate-600">
            Merged fingerprints for{" "}
            {getContactHighlightModelMeta(selectedModelId).label}
            {selectedMergeRun.stats.inputCardCount > 0
              ? ` · ${selectedMergeRun.stats.inputCardCount} → ${selectedMergeRun.stats.cardCount} unique`
              : ` · ${selectedMergeRun.stats.cardCount} unique card${selectedMergeRun.stats.cardCount === 1 ? "" : "s"}`}
            {selectedMergeRun.usage.modelName
              ? ` · API model ${selectedMergeRun.usage.modelName}`
              : ""}
            . Open Entity cards → All emails (merged) to review.
          </p>
        ) : selectedRun?.thirdPass ? (
          <p className="text-sm text-slate-500">
            Fingerprints are done — select this 4th-pass row and run merge to
            combine duplicate people across emails.
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Run the fingerprint (3rd) pass before merging.
          </p>
        )
      ) : selectedPass === 3 ? (
        selectedFingerprintRun ? (
          <p className="text-sm text-slate-600">
            Fingerprints for{" "}
            {getContactHighlightModelMeta(selectedModelId).label}
            {` · ${selectedFingerprintRun.stats.cardCount} entity card${selectedFingerprintRun.stats.cardCount === 1 ? "" : "s"}`}
            {selectedFingerprintRun.stats.skipped > 0
              ? ` · ${selectedFingerprintRun.stats.skipped} empty/skipped`
              : ""}
            {selectedFingerprintRun.usage.modelName
              ? ` · API model ${selectedFingerprintRun.usage.modelName}`
              : ""}
            . Run the 4th pass to merge duplicates, then open Entity cards.
          </p>
        ) : selectedRun ? (
          <p className="text-sm text-slate-500">
            First pass is done — select this 3rd-pass row and run fingerprints
            to build entity cards from headers, body, and prior extractions.
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Run the first pass before fingerprints.
          </p>
        )
      ) : selectedPassRun ? (
        <p className="text-sm text-slate-600">
          Showing{" "}
          {selectedPass === 2 ? "new second-pass finds for " : "highlights for "}
          {getContactHighlightModelMeta(selectedModelId).label}
          {selectedPassRun.stats.skipped > 0
            ? ` · ${selectedPassRun.stats.skipped} empty/skipped`
            : ""}
          {selectedPassRun.usage.modelName
            ? ` · API model ${selectedPassRun.usage.modelName}`
            : ""}
        </p>
      ) : selectedPass === 2 && selectedRun ? (
        <p className="text-sm text-slate-500">
          First pass is done — select this 2nd-pass row and run it to look for
          missed contacts.
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          No extraction for the selected model yet — email bodies show the
          usual unique-text highlight only.
        </p>
      )}

      {selectedPassRun && selectedPass !== 3 && selectedPass !== 4 ? (
        <ContactHighlightLegend />
      ) : null}

      <EntityCardsSidePanel
        open={entityPanelOpen}
        onClose={() => setEntityPanelOpen(false)}
        kind={entityPanelKind}
        onKindChange={setEntityPanelKind}
        contactEntityCardsByEmailId={panelEntityCards}
        contactMergedEntityCards={panelMergedCards}
        contactModelLabel={
          selectedRun
            ? getContactHighlightModelMeta(selectedModelId).label
            : null
        }
        orgEntityCardsByEmailId={panelOrgEntityCards}
        orgMergedEntityCards={panelOrgMergedCards}
        orgModelLabel={
          preferredOrgRun
            ? getOrgHighlightModelMeta(preferredOrgRun.modelId).label
            : null
        }
        emailOptions={emailOptions}
        selectedEmailId={entityFilterEmailId}
        onSelectedEmailIdChange={setEntityFilterEmailId}
      />
    </div>
  );
}

function ContactHighlightLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {CONTACT_HIGHLIGHT_TYPES.map((type: ContactHighlightType) => (
        <li key={type} className="inline-flex items-center gap-1.5">
          <span className={CONTACT_HIGHLIGHT_CLASS[type]}>Aa</span>
          <span>{CONTACT_HIGHLIGHT_LABELS[type]}</span>
        </li>
      ))}
    </ul>
  );
}
