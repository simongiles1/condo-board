import { Fragment } from "react";

import {
  CONTACT_HIGHLIGHT_MODELS,
  getContactHighlightModelMeta,
} from "@/lib/email-analysis/contact-highlight-models";
import type { ContactHighlightModelRunDisplay } from "@/lib/email-analysis/contact-highlight-run-display";
import {
  CONTACT_HIGHLIGHT_CLASS,
  CONTACT_HIGHLIGHT_LABELS,
  CONTACT_HIGHLIGHT_TYPES,
} from "@/lib/email-analysis/contact-highlight-shared";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";

type Props = {
  runs: Partial<Record<string, ContactHighlightModelRunDisplay>>;
  /** Compact styling for hover popovers. */
  compact?: boolean;
};

/**
 * Read-only contact-extraction model table (same columns/nested pass rows as
 * the thread page extract panel). Only models present in `runs` are shown.
 */
export function ContactExtractRunsTable({ runs, compact = false }: Props) {
  const cell = compact ? "px-2 py-1.5" : "px-3 py-2.5";
  const headCell = compact ? "px-2 py-1.5" : "px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className={headCell}>
              Model
            </th>
            <th scope="col" className={headCell}>
              Rate (in/out)
            </th>
            {CONTACT_HIGHLIGHT_TYPES.map((type) => (
              <th key={type} scope="col" className={headCell}>
                <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                  <span className={CONTACT_HIGHLIGHT_CLASS[type]}>Aa</span>
                  {CONTACT_HIGHLIGHT_LABELS[type]}
                </span>
              </th>
            ))}
            <th scope="col" className={headCell}>
              Cost
            </th>
            <th scope="col" className={headCell}>
              Tokens
            </th>
            <th scope="col" className={headCell}>
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {CONTACT_HIGHLIGHT_MODELS.filter((modelId) => runs[modelId]).map(
            (modelId) => {
            const meta = getContactHighlightModelMeta(modelId);
            const run = runs[modelId]!;
            const secondPass = run.secondPass ?? null;
            const thirdPass = run.thirdPass ?? null;
            const fourthPass = run.fourthPass ?? null;
            const secondPassNewCount = secondPass
              ? secondPass.stats.typeCounts.contact_name +
                secondPass.stats.typeCounts.phone +
                secondPass.stats.typeCounts.job_title +
                secondPass.stats.typeCounts.company_name
              : 0;

            return (
              <Fragment key={modelId}>
                <tr>
                  <td className={`${cell} font-medium text-slate-900`}>
                    {meta.label}
                  </td>
                  <td className={`${cell} tabular-nums text-slate-600`}>
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
                      className={`${cell} tabular-nums text-slate-700`}
                    >
                      {run.stats.typeCounts[type]}
                    </td>
                  ))}
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {formatCostUsd(run.usage.costUsd)}
                  </td>
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {`${formatTokenCount(run.usage.inputTokens)} / ${formatTokenCount(run.usage.outputTokens)}`}
                  </td>
                  <td className={`${cell} text-slate-600`}>
                    {run.stats.failed > 0
                      ? `Done (${run.stats.failed} failed)`
                      : "Done"}
                  </td>
                </tr>
                <tr className="bg-slate-50/60">
                  <td className={`${cell} pl-8 text-slate-700`}>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {meta.secondPassLabel}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      new finds only
                    </span>
                  </td>
                  <td className={`${cell} tabular-nums text-slate-500`}>
                    {meta.secondPass.thinking && !meta.firstPass.thinking
                      ? "thinking on"
                      : meta.chunking
                        ? `${meta.chunking.minChars}–${meta.chunking.maxChars} chars`
                        : "same model"}
                  </td>
                  {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                    <td
                      key={type}
                      className={`${cell} tabular-nums text-slate-700`}
                    >
                      {secondPass ? secondPass.stats.typeCounts[type] : "—"}
                    </td>
                  ))}
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {secondPass
                      ? formatCostUsd(secondPass.usage.costUsd)
                      : "—"}
                  </td>
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {secondPass
                      ? `${formatTokenCount(secondPass.usage.inputTokens)} / ${formatTokenCount(secondPass.usage.outputTokens)}`
                      : "—"}
                  </td>
                  <td className={`${cell} text-slate-600`}>
                    {secondPass
                      ? secondPass.stats.failed > 0
                        ? `Done (${secondPass.stats.failed} failed)`
                        : secondPassNewCount > 0
                          ? `Done · ${secondPassNewCount} new`
                          : "Done · none new"
                      : "Not run"}
                  </td>
                </tr>
                <tr className="bg-slate-50/40">
                  <td className={`${cell} pl-8 text-slate-700`}>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {meta.thirdPassLabel}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      entity cards
                    </span>
                  </td>
                  <td className={`${cell} tabular-nums text-slate-500`}>
                    {meta.thirdPass.thinking && !meta.firstPass.thinking
                      ? "thinking on"
                      : "full email"}
                  </td>
                  {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                    <td
                      key={type}
                      className={`${cell} tabular-nums text-slate-400`}
                    >
                      —
                    </td>
                  ))}
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {thirdPass ? formatCostUsd(thirdPass.usage.costUsd) : "—"}
                  </td>
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {thirdPass
                      ? `${formatTokenCount(thirdPass.usage.inputTokens)} / ${formatTokenCount(thirdPass.usage.outputTokens)}`
                      : "—"}
                  </td>
                  <td className={`${cell} text-slate-600`}>
                    {thirdPass
                      ? thirdPass.stats.failed > 0
                        ? `Done (${thirdPass.stats.failed} failed)`
                        : `Done · ${thirdPass.stats.cardCount} card${thirdPass.stats.cardCount === 1 ? "" : "s"}`
                      : "Not run"}
                  </td>
                </tr>
                <tr className="bg-slate-50/30">
                  <td className={`${cell} pl-8 text-slate-700`}>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {meta.fourthPassLabel}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      unique people
                    </span>
                  </td>
                  <td className={`${cell} tabular-nums text-slate-500`}>
                    {meta.fourthPass.thinking && !meta.firstPass.thinking
                      ? "thinking on"
                      : "all cards"}
                  </td>
                  {CONTACT_HIGHLIGHT_TYPES.map((type) => (
                    <td
                      key={type}
                      className={`${cell} tabular-nums text-slate-400`}
                    >
                      —
                    </td>
                  ))}
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {fourthPass
                      ? formatCostUsd(fourthPass.usage.costUsd)
                      : "—"}
                  </td>
                  <td className={`${cell} tabular-nums text-slate-700`}>
                    {fourthPass
                      ? `${formatTokenCount(fourthPass.usage.inputTokens)} / ${formatTokenCount(fourthPass.usage.outputTokens)}`
                      : "—"}
                  </td>
                  <td className={`${cell} text-slate-600`}>
                    {!thirdPass
                      ? "Needs 3rd pass"
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
          },
          )}
        </tbody>
      </table>
    </div>
  );
}
