import { Fragment } from "react";

import {
  PROJECT_HIGHLIGHT_MODELS,
  getProjectHighlightModelMeta,
} from "@/lib/email-analysis/project-highlight-models";
import type { ProjectHighlightModelRunDisplay } from "@/lib/email-analysis/project-highlight-run-display";
import {
  PROJECT_HIGHLIGHT_CLASS,
  PROJECT_HIGHLIGHT_LABELS,
  PROJECT_HIGHLIGHT_TYPES,
} from "@/lib/email-analysis/project-highlight-shared";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";

type Props = {
  runs: Partial<Record<string, ProjectHighlightModelRunDisplay>>;
  /** Compact styling for hover popovers. */
  compact?: boolean;
};

/**
 * Read-only project-extraction model table (same columns/nested pass rows as
 * the contact extraction table). Only models present in `runs` are shown.
 */
export function ProjectExtractRunsTable({ runs, compact = false }: Props) {
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
            {PROJECT_HIGHLIGHT_TYPES.map((type) => (
              <th key={type} scope="col" className={headCell}>
                <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                  <span className={PROJECT_HIGHLIGHT_CLASS[type]}>Aa</span>
                  {PROJECT_HIGHLIGHT_LABELS[type]}
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
          {PROJECT_HIGHLIGHT_MODELS.filter((modelId) => runs[modelId]).map(
            (modelId) => {
              const meta = getProjectHighlightModelMeta(modelId);
              const run = runs[modelId]!;
              const secondPass = run.secondPass ?? null;
              const thirdPass = run.thirdPass ?? null;
              const fourthPass = run.fourthPass ?? null;
              const secondPassNewCount = secondPass
                ? secondPass.stats.typeCounts.project_name +
                  secondPass.stats.typeCounts.year_hint +
                  secondPass.stats.typeCounts.phase +
                  secondPass.stats.typeCounts.contractor +
                  secondPass.stats.typeCounts.location
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
                    {PROJECT_HIGHLIGHT_TYPES.map((type) => (
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
                        ? "Thinking"
                        : "—"}
                    </td>
                    {secondPass
                      ? PROJECT_HIGHLIGHT_TYPES.map((type) => (
                          <td
                            key={type}
                            className={`${cell} tabular-nums text-slate-600`}
                          >
                            {secondPass.stats.typeCounts[type]}
                          </td>
                        ))
                      : PROJECT_HIGHLIGHT_TYPES.map((type) => (
                          <td
                            key={type}
                            className={`${cell} tabular-nums text-slate-400`}
                          >
                            —
                          </td>
                        ))}
                    <td className={`${cell} tabular-nums text-slate-600`}>
                      {secondPass
                        ? formatCostUsd(secondPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className={`${cell} tabular-nums text-slate-600`}>
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
                    </td>
                    <td className={`${cell} tabular-nums text-slate-500`}>—</td>
                    {PROJECT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className={`${cell} tabular-nums text-slate-400`}
                      >
                        —
                      </td>
                    ))}
                    <td className={`${cell} tabular-nums text-slate-600`}>
                      {thirdPass
                        ? formatCostUsd(thirdPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className={`${cell} tabular-nums text-slate-600`}>
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
                  <tr className="bg-slate-50/20">
                    <td className={`${cell} pl-8 text-slate-700`}>
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {meta.fourthPassLabel}
                      </span>
                    </td>
                    <td className={`${cell} tabular-nums text-slate-500`}>—</td>
                    {PROJECT_HIGHLIGHT_TYPES.map((type) => (
                      <td
                        key={type}
                        className={`${cell} tabular-nums text-slate-400`}
                      >
                        —
                      </td>
                    ))}
                    <td className={`${cell} tabular-nums text-slate-600`}>
                      {fourthPass
                        ? formatCostUsd(fourthPass.usage.costUsd)
                        : "—"}
                    </td>
                    <td className={`${cell} tabular-nums text-slate-600`}>
                      {fourthPass
                        ? `${formatTokenCount(fourthPass.usage.inputTokens)} / ${formatTokenCount(fourthPass.usage.outputTokens)}`
                        : "—"}
                    </td>
                    <td className={`${cell} text-slate-600`}>
                      {fourthPass
                        ? fourthPass.error
                          ? `Failed · ${fourthPass.error}`
                          : `Done · ${fourthPass.stats.cardCount} project${fourthPass.stats.cardCount === 1 ? "" : "s"}`
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
