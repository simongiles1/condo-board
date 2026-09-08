"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { IbmDoclingSpendPanel, type IbmDoclingSpendSummary } from "@/components/IbmDoclingSpendPanel";
import { PipelineStageInfoTooltip } from "@/components/PipelineStageInfoTooltip";
import {
  DEEPSEEK_V4_FLASH_OFF_PEAK_RATES,
  DEEPSEEK_V4_FLASH_PEAK_RATES,
  isDeepSeekModelName,
} from "@/lib/deepseek/pricing";
import {
  estimateCostBreakdown,
  flattenAiUsageToStages,
  formatCostUsd,
  formatPricePerMillion,
  formatTokenCount,
  getModelPricing,
  summarizeDeepSeekOffPeakOptimization,
  sumAiUsageStages,
  type AiUsageLog,
  type AiUsageStageRow,
} from "@/lib/gemini/usage";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

type DialogTab = "usage" | "watsonx";

const TOOLTIP_VIEWPORT_MARGIN = 8;
const USAGE_TABLE_GRID =
  "grid grid-cols-[minmax(11rem,1.35fr)_repeat(4,minmax(5.5rem,1fr))]";

function InfoCircleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function computeTooltipPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceAbove = triggerRect.top - TOOLTIP_VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - triggerRect.bottom - TOOLTIP_VIEWPORT_MARGIN;
  const showAbove = spaceAbove >= popoverHeight || spaceAbove >= spaceBelow;

  let top: number;
  if (showAbove) {
    top = Math.max(
      TOOLTIP_VIEWPORT_MARGIN,
      triggerRect.top - TOOLTIP_VIEWPORT_MARGIN - popoverHeight,
    );
  } else {
    top = Math.min(
      viewportHeight - TOOLTIP_VIEWPORT_MARGIN - popoverHeight,
      triggerRect.bottom + TOOLTIP_VIEWPORT_MARGIN,
    );
  }

  let left = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
  left = Math.min(
    Math.max(left, TOOLTIP_VIEWPORT_MARGIN),
    viewportWidth - TOOLTIP_VIEWPORT_MARGIN - popoverWidth,
  );

  return {
    position: "fixed",
    top,
    left,
    zIndex: 60,
  };
}

function UsageColumnHeaderTooltip({
  label,
  ariaLabel,
  scanGroup,
  children,
}: {
  label: string;
  ariaLabel: string;
  scanGroup: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ scanGroup });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle({
      ...computeTooltipPosition(triggerRect, popoverRect.width, popoverRect.height),
      visibility: "visible",
    });
  }, [hover.open]);

  return (
    <>
      <span
        ref={rootRef}
        className="inline-flex shrink-0 align-middle"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200/80 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          aria-label={ariaLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InfoCircleIcon />
        </button>
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="text-sm font-semibold text-slate-900">{label}</p>
              <div className="mt-2 space-y-2 text-sm leading-snug text-slate-700">{children}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AiUsageCostInfoTooltip() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ scanGroup: "ai-usage-cost-info" });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle({
      ...computeTooltipPosition(triggerRect, popoverRect.width, popoverRect.height),
      visibility: "visible",
    });
  }, [hover.open]);

  return (
    <>
      <span
        ref={rootRef}
        className="inline-flex shrink-0"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          aria-label="How usage costs are calculated"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InfoCircleIcon />
        </button>
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="text-sm font-semibold text-slate-900">How costs are calculated</p>
              <div className="mt-3 space-y-3 text-sm leading-snug text-slate-700">
                <div>
                  <p className="font-medium text-slate-900">DeepSeek V4 Flash (non-thinking)</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-600">
                    <li>
                      Off-peak input: $0.22/M cache miss, $0.007/M cache hit; output $0.66/M
                    </li>
                    <li>Peak rates are double those amounts</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Off-peak optimized total</p>
                  <p className="mt-1 text-slate-600">
                    The totals row shows an off-peak optimized estimate with cached vs uncached
                    input broken out separately.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Peak hours</p>
                  <p className="mt-1 text-slate-600">
                    01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Each API call is priced at
                    the tier active when it ran; stages that cross an hour boundary may show
                    &quot;Peak + off-peak&quot;.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Coverage &amp; accuracy</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-600">
                    <li>
                      Validate-stage usage is included from runs after this update; older meetings
                      may under-report that stage
                    </li>
                    <li>Gold-standard compare runs appear after the seven workflow stages</li>
                    <li>
                      Your provider dashboard may differ slightly when billing includes retries or
                      calls not yet written to the database
                    </li>
                    <li>
                      Ingest Docling page counts appear when markdown extraction was stored; dollar
                      cost for Docling is on the WatsonX tab
                    </li>
                  </ul>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function DeepSeekPromptCacheInfoTooltip() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ scanGroup: "deepseek-prompt-cache" });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle({
      ...computeTooltipPosition(triggerRect, popoverRect.width, popoverRect.height),
      visibility: "visible",
    });
  }, [hover.open]);

  return (
    <>
      <span
        ref={rootRef}
        className="inline-flex shrink-0 align-middle"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          aria-label="How DeepSeek prompt caching affects cost"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InfoCircleIcon />
        </button>
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="text-sm font-semibold text-slate-900">DeepSeek prompt caching</p>
              <div className="mt-2 space-y-2 text-sm leading-snug text-slate-700">
                <p>
                  When a later API call reuses the same prompt prefix — system instructions,
                  tool definitions, or other unchanged context — DeepSeek bills those input
                  tokens as <span className="font-medium">cache hits</span> instead of fresh input.
                </p>
                <p>
                  Investigate runs many tool rounds against the same system prompt, so later
                  rounds often have a high cache-hit ratio. The API reports this as{" "}
                  <span className="font-mono text-xs">prompt_cache_hit_tokens</span> and{" "}
                  <span className="font-mono text-xs">prompt_cache_miss_tokens</span>.
                </p>
                <p>
                  Off-peak cache hits are{" "}
                  {formatPricePerMillion(DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheHitPerMillion)}
                  /M versus{" "}
                  {formatPricePerMillion(DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheMissPerMillion)}
                  /M for cache misses. Peak hours double both rates.
                </p>
                <p className="text-slate-600">
                  The optimized total below assumes every call ran during off-peak hours while
                  keeping the same cached vs uncached split recorded for this meeting.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type Props = {
  open: boolean;
  usage?: AiUsageLog | null;
  stages?: AiUsageStageRow[] | null;
  loading?: boolean;
  onClose: () => void;
};

function TokenCostCell({
  tokenCount,
  costUsd,
  ratePerMillion,
  showRate = false,
}: {
  tokenCount: number;
  costUsd: number;
  ratePerMillion: number;
  showRate?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-slate-800">{formatTokenCount(tokenCount)}</div>
      <div className="font-mono text-xs text-slate-500">
        {formatCostUsd(costUsd)}
      </div>
      {showRate ? (
        <div className="font-mono text-[11px] text-slate-400">
          @ {formatPricePerMillion(ratePerMillion)}/M
        </div>
      ) : null}
    </div>
  );
}

function UsageStageRow({
  stage,
  showRatesInCells,
}: {
  stage: AiUsageStageRow;
  showRatesInCells: boolean;
}) {
  if (stage.notApplicable) {
    const subtitle =
      stage.stageKind === "user"
        ? "Manual"
        : stage.usageDetail
          ? stage.modelName !== "N/A" && stage.modelName
            ? stage.modelName
            : stage.usageDetail
          : stage.modelName !== "N/A"
            ? stage.modelName
            : "No usage recorded";

    return (
      <div
        className={`${USAGE_TABLE_GRID} border-b border-slate-100 text-sm text-slate-500`}
      >
        <div className="px-4 py-3 align-top">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700">{stage.label}</span>
            <PipelineStageInfoTooltip stageId={stage.id} label={stage.label} />
            {stage.stageKind === "user" ? (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Manual
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
          {stage.usageDetail ? (
            <div className="mt-1 text-[11px] font-medium text-slate-600">{stage.usageDetail}</div>
          ) : null}
        </div>
        <div className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</div>
        <div className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</div>
        <div className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</div>
        <div className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</div>
      </div>
    );
  }

  const breakdown = estimateCostBreakdown(stage.modelName, stage);

  return (
    <div className={`${USAGE_TABLE_GRID} border-b border-slate-100 text-sm`}>
      <div className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{stage.label}</span>
          <PipelineStageInfoTooltip stageId={stage.id} label={stage.label} />
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {stage.modelName}
          {breakdown.deepSeekTier ? (
            <span className="ml-2 text-slate-500">
              ·{" "}
              {breakdown.deepSeekTier === "mixed"
                ? "Peak + off-peak"
                : breakdown.deepSeekTier === "peak"
                  ? "Peak"
                  : "Off-peak"}
            </span>
          ) : null}
        </div>
        {stage.usageDetail ? (
          <div className="mt-1 text-[11px] font-medium text-slate-600">{stage.usageDetail}</div>
        ) : null}
      </div>
      <div className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={stage.inputTokens}
          costUsd={breakdown.inputCostUsd}
          ratePerMillion={breakdown.pricing.inputPerMillion}
          showRate={showRatesInCells}
        />
      </div>
      <div className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={stage.outputTokens}
          costUsd={breakdown.outputCostUsd}
          ratePerMillion={breakdown.pricing.outputPerMillion}
          showRate={showRatesInCells}
        />
      </div>
      <div className="px-4 py-3 text-right align-top font-mono text-slate-800">
        {formatTokenCount(stage.totalTokens)}
      </div>
      <div className="px-4 py-3 text-right align-top font-mono font-medium text-slate-900">
        {formatCostUsd(breakdown.totalCostUsd)}
      </div>
    </div>
  );
}

export function AiUsageDialog({ open, usage, stages, loading = false, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DialogTab>("usage");
  const [watsonxSummary, setWatsonxSummary] = useState<IbmDoclingSpendSummary | null>(null);
  const [watsonxLoading, setWatsonxLoading] = useState(false);
  const [watsonxError, setWatsonxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveTab("usage");
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || activeTab !== "watsonx") return;

    let cancelled = false;
    setWatsonxLoading(true);
    setWatsonxError(null);

    async function loadWatsonxSummary() {
      try {
        const response = await fetch("/api/analysis/docling-backfill/ibm-spend");
        const payload = (await response.json()) as IbmDoclingSpendSummary & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load WatsonX key information.");
        }
        if (!cancelled) {
          setWatsonxSummary(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setWatsonxError(
            error instanceof Error ? error.message : "Could not load WatsonX key information.",
          );
          setWatsonxSummary(null);
        }
      } finally {
        if (!cancelled) {
          setWatsonxLoading(false);
        }
      }
    }

    void loadWatsonxSummary();

    return () => {
      cancelled = true;
    };
  }, [open, activeTab]);

  const resolvedStages = useMemo(() => {
    if (stages?.length) return stages;
    return flattenAiUsageToStages(usage);
  }, [stages, usage]);

  const totals = useMemo(
    () => sumAiUsageStages(resolvedStages),
    [resolvedStages],
  );
  const offPeakOptimization = useMemo(
    () => summarizeDeepSeekOffPeakOptimization(resolvedStages),
    [resolvedStages],
  );
  const uniqueModels = useMemo(
    () => [...new Set(resolvedStages.filter((stage) => !stage.notApplicable).map((stage) => stage.modelName))],
    [resolvedStages],
  );
  const headerPricing =
    uniqueModels.length === 1 ? getModelPricing(uniqueModels[0]) : null;
  const headerDeepSeekOffPeak = uniqueModels.length === 1 &&
    isDeepSeekModelName(uniqueModels[0]);
  const showRatesInCells = uniqueModels.length !== 1;
  const usageTableReady = activeTab === "usage" && !loading && resolvedStages.length > 0;

  if (!open) return null;

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
        aria-labelledby="ai-usage-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="ai-usage-title"
            className="text-xl font-semibold text-slate-900"
          >
            AI usage &amp; cost
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {activeTab === "usage"
              ? "Workflow stages plus gold-standard compare runs — token costs for automated stages, manual steps marked N/A."
              : "IBM watsonx Docling trial keys loaded from .env.local and their spend."}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
              role="tablist"
              aria-label="AI usage views"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "usage"}
                onClick={() => setActiveTab("usage")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "usage"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Usage
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "watsonx"}
                onClick={() => setActiveTab("watsonx")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "watsonx"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                WatsonX
              </button>
            </div>
            {activeTab === "usage" ? <AiUsageCostInfoTooltip /> : null}
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 px-6 py-5 ${
            usageTableReady
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
          {activeTab === "usage" ? (
            <>
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Loading usage data…
            </div>
          ) : resolvedStages.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No usage data recorded for this meeting. Newly generated meetings
              track usage automatically; older meetings do not.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200">
              <div
                className={`${USAGE_TABLE_GRID} shrink-0 border-b border-slate-200 bg-slate-50 text-sm`}
              >
                <div className="px-4 py-3 text-left font-semibold text-slate-700">
                  Stage
                </div>
                <div className="px-4 py-3 text-right font-semibold text-slate-700">
                  <div className="inline-flex items-center justify-end gap-1">
                    <span>Input tokens</span>
                    <UsageColumnHeaderTooltip
                      label="Input token rates"
                      ariaLabel="Input token pricing"
                      scanGroup="usage-input-token-rates"
                    >
                      {headerDeepSeekOffPeak ? (
                        <>
                          <div>
                            <p className="font-medium text-slate-900">Off-peak</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-600">
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheMissPerMillion)}
                              /M cache miss ·{" "}
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheHitPerMillion)}
                              /M cache hit
                            </p>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">Peak (2×)</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-600">
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_PEAK_RATES.inputCacheMissPerMillion)}
                              /M cache miss ·{" "}
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_PEAK_RATES.inputCacheHitPerMillion)}
                              /M cache hit
                            </p>
                          </div>
                        </>
                      ) : headerPricing ? (
                        <p className="font-mono text-xs text-slate-600">
                          {formatPricePerMillion(headerPricing.inputPerMillion)}/M
                        </p>
                      ) : (
                        <p className="text-slate-600">Rate varies by model across stages.</p>
                      )}
                    </UsageColumnHeaderTooltip>
                  </div>
                </div>
                <div className="px-4 py-3 text-right font-semibold text-slate-700">
                  <div className="inline-flex items-center justify-end gap-1">
                    <span>Output tokens</span>
                    <UsageColumnHeaderTooltip
                      label="Output token rates"
                      ariaLabel="Output token pricing"
                      scanGroup="usage-output-token-rates"
                    >
                      {headerDeepSeekOffPeak ? (
                        <>
                          <div>
                            <p className="font-medium text-slate-900">Off-peak</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-600">
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.outputPerMillion)}/M
                            </p>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">Peak (2×)</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-600">
                              {formatPricePerMillion(DEEPSEEK_V4_FLASH_PEAK_RATES.outputPerMillion)}/M
                            </p>
                          </div>
                        </>
                      ) : headerPricing ? (
                        <p className="font-mono text-xs text-slate-600">
                          {formatPricePerMillion(headerPricing.outputPerMillion)}/M
                        </p>
                      ) : (
                        <p className="text-slate-600">Rate varies by model across stages.</p>
                      )}
                    </UsageColumnHeaderTooltip>
                  </div>
                </div>
                <div className="px-4 py-3 text-right font-semibold text-slate-700">
                  Total tokens
                </div>
                <div className="px-4 py-3 text-right font-semibold text-slate-700">
                  Est. cost
                </div>
              </div>

              <div className="min-h-[14rem] flex-1 overflow-y-auto overflow-x-auto bg-white">
                {resolvedStages.map((stage) => (
                  <UsageStageRow
                    key={stage.id}
                    stage={stage}
                    showRatesInCells={showRatesInCells}
                  />
                ))}
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-slate-50 text-sm">
                <div className={USAGE_TABLE_GRID}>
                  <div className="px-4 py-3 text-left font-semibold text-slate-900">
                    Total
                  </div>
                  <div className="px-4 py-3 text-right align-top">
                    <div className="font-mono font-semibold text-slate-900">
                      {formatTokenCount(totals.inputTokens)}
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-600">
                      {formatCostUsd(totals.inputCostUsd)}
                    </div>
                  </div>
                  <div className="px-4 py-3 text-right align-top">
                    <div className="font-mono font-semibold text-slate-900">
                      {formatTokenCount(totals.outputTokens)}
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-600">
                      {formatCostUsd(totals.outputCostUsd)}
                    </div>
                  </div>
                  <div className="px-4 py-3 text-right align-top font-mono font-semibold text-slate-900">
                    {formatTokenCount(totals.totalTokens)}
                  </div>
                  <div className="px-4 py-3 text-right align-top font-mono font-semibold text-teal-800">
                    {formatCostUsd(totals.costUsd)}
                  </div>
                </div>
                {offPeakOptimization ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
                    <span>
                      Cached in{" "}
                      <span className="font-mono text-slate-700">
                        {formatTokenCount(offPeakOptimization.cacheHitTokens)}
                      </span>
                      <span className="font-mono text-slate-600">
                        {" "}
                        → {formatCostUsd(offPeakOptimization.offPeakInputCacheHitCostUsd)}
                      </span>
                    </span>
                    <span>
                      Uncached in{" "}
                      <span className="font-mono text-slate-700">
                        {formatTokenCount(offPeakOptimization.cacheMissTokens)}
                      </span>
                      <span className="font-mono text-slate-600">
                        {" "}
                        → {formatCostUsd(offPeakOptimization.offPeakInputCacheMissCostUsd)}
                      </span>
                    </span>
                    <span className="font-mono text-slate-600">
                      Off-peak out → {formatCostUsd(offPeakOptimization.offPeakOutputCostUsd)}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-slate-600">
                      <span>Off-peak optimized</span>
                      <DeepSeekPromptCacheInfoTooltip />
                      <span className="font-mono font-semibold text-emerald-700">
                        {formatCostUsd(offPeakOptimization.offPeakTotalCostUsd)}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

            </>
          ) : watsonxLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Loading WatsonX key information…
            </div>
          ) : watsonxError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {watsonxError}
            </div>
          ) : watsonxSummary ? (
            <div className="space-y-4">
              <IbmDoclingSpendPanel summary={watsonxSummary} />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Environment variables</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-slate-600">
                  <li>DOCLING_IBM_URL — hosted watsonx Docling base URL</li>
                  <li>DOCLING_IBM_API_KEY — primary trial API key</li>
                  <li>DOCLING_IBM_URL_2 / DOCLING_IBM_API_KEY_2 — extra trial slots (_3, _4)</li>
                  <li>DOCLING_IBM_USD_PER_PAGE — billed rate (default $0.004/page)</li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Keys are read from .env.local on this machine. If URL_N is omitted, key N reuses
                  DOCLING_IBM_URL.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No WatsonX key information available.
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiUsageIconButton({
  onClick,
  disabled,
  title = "View AI usage and cost",
  tone = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "inverse";
}) {
  const toneClass =
    tone === "inverse"
      ? "border-white/15 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    </button>
  );
}
