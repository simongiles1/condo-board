"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmailAttachmentViewerDialog } from "@/components/EmailAttachmentViewerDialog";
import { formatFiscalYearLabel } from "@/lib/budget/classify-documents";
import {
  formatLinearityPercent,
  lineItemLinearity,
} from "@/lib/budget/linearity";
import type {
  BudgetLineItem,
  BudgetPageData,
  BudgetYearDocument,
} from "@/lib/budget/types";
import {
  attachmentKind,
  attachmentKindClasses,
  type EmailAttachmentSummary,
} from "@/lib/email/attachment-display";

function FileTypeIcon({
  kind,
}: {
  kind: ReturnType<typeof attachmentKind>;
}) {
  const className = "h-5 w-5 shrink-0";
  if (kind === "pdf") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" className={className}>
        <rect width="20" height="20" rx="4" fill="currentColor" />
        <text
          x="10"
          y="13.5"
          textAnchor="middle"
          fill="white"
          fontSize="6.2"
          fontWeight="800"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          PDF
        </text>
      </svg>
    );
  }
  if (kind === "sheet") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" className={className}>
        <rect width="20" height="20" rx="4" fill="currentColor" />
        <path
          d="M5.2 5.2 14.8 14.8M14.8 5.2 5.2 14.8"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={className}
      fill="currentColor"
    >
      <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5.379a1.5 1.5 0 0 1 1.06.44l3.622 3.62A1.5 1.5 0 0 1 16 6.122V16.5A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-14Z" />
    </svg>
  );
}

function ClosePanelIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

const CATEGORY_ORDER = [
  "Revenue",
  "Administration",
  "Utilities",
  "Contracts",
  "Repairs and maintenance",
  "Reserve fund",
  "Other",
];

const EXPENSE_CATEGORIES = new Set(
  CATEGORY_ORDER.filter((category) => category !== "Revenue"),
);

function formatCad(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactCad(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return formatCad(value);
}

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function sumCategory(
  lines: BudgetLineItem[],
  year: number,
  field: "budgeted" | "actual",
  predicate: (line: BudgetLineItem) => boolean,
): number | null {
  let total = 0;
  let sawValue = false;
  for (const line of lines) {
    if (!predicate(line)) continue;
    const value = line.byYear[year]?.[field];
    if (value == null) continue;
    total += value;
    sawValue = true;
  }
  return sawValue ? total : null;
}

const LINE_COL_REM = 18;
const LINEAR_COL_REM = 5;
const AMOUNT_COL_REM = 7;

const LINEARITY_HEADER_TITLE =
  "How tightly the plotted amounts hug a straight line, as a share of the typical dollar amount. 100% = points sit on a line. Uses the worse of budgeted vs actual. Needs three years.";

function tableWidthRem(yearCount: number): number {
  return LINE_COL_REM + LINEAR_COL_REM + yearCount * 2 * AMOUNT_COL_REM;
}

function stickyLinearStyle(): { left: string } {
  return { left: `${LINE_COL_REM}rem` };
}

function linearityToneClass(score: number): string {
  if (score >= 0.95) return "text-teal-800";
  if (score >= 0.8) return "text-amber-800";
  return "text-rose-800";
}

type BudgetTabId = "plots" | "documents" | "line-items";

type BudgetPlotTarget =
  | { type: "line"; code: string }
  | { type: "category"; name: string };

const BUDGET_TABS: Array<{ id: BudgetTabId; label: string }> = [
  { id: "plots", label: "Plots" },
  { id: "documents", label: "Documents" },
  { id: "line-items", label: "Line items" },
];

export function BuildingBudgetClient({ data }: { data: BudgetPageData }) {
  const defaultTarget: BudgetPlotTarget = {
    type: "line",
    code:
      data.lines.find((line) => line.code === "4010")?.code ??
      data.lines[0]?.code ??
      "",
  };
  const [selection, setSelection] = useState<BudgetPlotTarget>(defaultTarget);
  const [lineDetailOpen, setLineDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BudgetTabId>("plots");
  const [preview, setPreview] = useState<EmailAttachmentSummary | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);

  const documentsByYear = useMemo(() => {
    const grouped = new Map<number, BudgetYearDocument[]>();
    for (const document of data.documents) {
      const list = grouped.get(document.fiscalYearStart) ?? [];
      list.push(document);
      grouped.set(document.fiscalYearStart, list);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  }, [data.documents]);

  const groupedLines = useMemo(() => {
    const groups = new Map<string, BudgetLineItem[]>();
    for (const line of data.lines) {
      const list = groups.get(line.category) ?? [];
      list.push(line);
      groups.set(line.category, list);
    }
    return [...groups.entries()].sort(
      (a, b) => categoryRank(a[0]) - categoryRank(b[0]),
    );
  }, [data.lines]);

  const selectedLine =
    selection.type === "line"
      ? (data.lines.find((line) => line.code === selection.code) ??
        data.lines[0])
      : undefined;
  const selectedCategory =
    selection.type === "category" ? selection.name : undefined;
  const selectedCategoryLines = useMemo(() => {
    if (!selectedCategory) return [];
    return groupedLines.find(([name]) => name === selectedCategory)?.[1] ?? [];
  }, [groupedLines, selectedCategory]);

  const plotTitle = selectedCategory
    ? selectedCategory
    : selectedLine
      ? `${selectedLine.code} ${selectedLine.name}`
      : "Line item";
  const plotEyebrow = selectedCategory
    ? `Sum of ${selectedCategoryLines.length} line items`
    : selectedLine?.code;

  const aggregateSeries = useMemo(
    () =>
      data.years.map((year) => ({
        year,
        yearLabel: formatFiscalYearLabel(year),
        revenueBudgeted: sumCategory(
          data.lines,
          year,
          "budgeted",
          (line) => line.category === "Revenue",
        ),
        revenueActual: sumCategory(
          data.lines,
          year,
          "actual",
          (line) => line.category === "Revenue",
        ),
        expensesBudgeted: sumCategory(data.lines, year, "budgeted", (line) =>
          EXPENSE_CATEGORIES.has(line.category),
        ),
        expensesActual: sumCategory(data.lines, year, "actual", (line) =>
          EXPENSE_CATEGORIES.has(line.category),
        ),
      })),
    [data.lines, data.years],
  );

  const lineSeries = useMemo(
    () =>
      data.years.map((year) => ({
        year,
        yearLabel: formatFiscalYearLabel(year),
        budgeted: selectedCategory
          ? sumCategory(selectedCategoryLines, year, "budgeted", () => true)
          : (selectedLine?.byYear[year]?.budgeted ?? null),
        actual: selectedCategory
          ? sumCategory(selectedCategoryLines, year, "actual", () => true)
          : (selectedLine?.byYear[year]?.actual ?? null),
      })),
    [data.years, selectedCategory, selectedCategoryLines, selectedLine],
  );

  function openLineDetail(code: string) {
    setSelection({ type: "line", code });
    setLineDetailOpen(true);
  }

  function openCategoryDetail(category: string) {
    setSelection({ type: "category", name: category });
    setLineDetailOpen(true);
  }

  useEffect(() => {
    if (!lineDetailOpen || activeTab !== "line-items") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLineDetailOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lineDetailOpen, activeTab]);

  function syncHorizontalScroll(source: "header" | "body") {
    if (syncingScroll.current) return;
    const header = headerScrollRef.current;
    const body = bodyScrollRef.current;
    if (!header || !body) return;
    syncingScroll.current = true;
    if (source === "body") header.scrollLeft = body.scrollLeft;
    else body.scrollLeft = header.scrollLeft;
    syncingScroll.current = false;
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Budget &amp; financials
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Operating budget line items extracted from emailed TSCC 2517 budget
          packages (fiscal years May–April). Projected columns from the next
          year’s package are treated as actuals.
        </p>
      </div>

      <div className="mt-4 shrink-0">
        <BudgetTabStrip active={activeTab} onChange={setActiveTab} />
      </div>

      <div
        className={
          activeTab === "line-items"
            ? "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mt-4 min-h-0 flex-1 overflow-y-auto pb-6"
        }
      >

      {activeTab === "documents" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Documents by year
          </h2>
          <p className="text-sm text-slate-600">
            Parsed files all contribute figures. A Final PDF outranks drafts;
            when rank ties, the later email wins. <span className="font-medium text-slate-800">Primary</span> is
            that winner for the year.
          </p>
          {documentsByYear.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              No operating budget attachments found yet.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {documentsByYear.map(([year, documents]) => (
                <div
                  key={year}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {formatFiscalYearLabel(year)}
                  </p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {documents.map((document) => {
                      const kind = attachmentKind(
                        document.mimeType,
                        document.filename,
                      );
                      return (
                        <li key={document.id}>
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({
                                id: document.id,
                                filename: document.filename,
                                mimeType: document.mimeType,
                                sizeBytes: document.sizeBytes,
                              })
                            }
                            className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm font-medium ring-1 transition hover:ring-2 hover:ring-teal-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${attachmentKindClasses(kind)}`}
                            title={document.filename}
                          >
                            <FileTypeIcon kind={kind} />
                            <span className="min-w-0 truncate">
                              {document.filename}
                            </span>
                            {document.isPrimarySource ? (
                              <span className="shrink-0 rounded bg-teal-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                primary
                              </span>
                            ) : document.usedForExtraction ? (
                              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                extracted
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "plots" ? (
        data.lines.length === 0 ? (
          <EmptyBudgetFigures />
        ) : (
          <div className="space-y-4">
            <ChartCard title="All line items">
              <BudgetLineChart
                data={aggregateSeries}
                series={[
                  {
                    key: "revenueBudgeted",
                    label: "Revenue (budgeted)",
                    color: "#0f766e",
                  },
                  {
                    key: "expensesBudgeted",
                    label: "Expenditures (budgeted)",
                    color: "#c2410c",
                  },
                  {
                    key: "revenueActual",
                    label: "Revenue (actual)",
                    color: "#0f766e",
                    dashed: true,
                  },
                  {
                    key: "expensesActual",
                    label: "Expenditures (actual)",
                    color: "#c2410c",
                    dashed: true,
                  },
                ]}
              />
            </ChartCard>
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard title={plotTitle}>
                <BudgetLineChart
                  data={lineSeries}
                  series={[
                    { key: "budgeted", label: "Budgeted", color: "#0369a1" },
                    {
                      key: "actual",
                      label: "Actual (projected)",
                      color: "#7c3aed",
                      dashed: true,
                    },
                  ]}
                />
              </ChartCard>
              <section className="flex max-h-[32rem] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                  <h2 className="text-base font-semibold text-slate-900">
                    Line items
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Click a line or a section header to plot budgeted vs actual.
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {groupedLines.map(([category, lines]) => {
                    const categorySelected = category === selectedCategory;
                    return (
                    <div key={category}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelection({ type: "category", name: category })
                        }
                        className={`sticky top-0 z-10 w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide transition ${
                          categorySelected
                            ? "bg-teal-100 text-teal-800"
                            : "bg-slate-50 text-slate-500 hover:bg-teal-50 hover:text-teal-800"
                        }`}
                      >
                        {category}
                      </button>
                      <ul>
                        {lines.map((line) => {
                          const selected =
                            selection.type === "line" &&
                            line.code === selectedLine?.code;
                          return (
                            <li key={line.code}>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelection({ type: "line", code: line.code })
                                }
                                className={`flex w-full items-baseline gap-2 border-t border-slate-100 px-4 py-2 text-left text-sm transition hover:bg-teal-50 ${
                                  selected ? "bg-teal-50" : "bg-white"
                                }`}
                              >
                                <span className="shrink-0 font-mono text-xs text-slate-500">
                                  {line.code}
                                </span>
                                <span className="font-medium text-slate-900">
                                  {line.name}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )
      ) : null}

      {activeTab === "line-items" ? (
        data.lines.length === 0 ? (
          <EmptyBudgetFigures />
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div
                ref={headerScrollRef}
                onScroll={() => syncHorizontalScroll("header")}
                className="shrink-0 overflow-x-auto overflow-y-hidden bg-slate-50 [scrollbar-gutter:stable] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <table
                  className="table-fixed border-separate border-spacing-0 text-left text-sm"
                  style={{ width: `${tableWidthRem(data.years.length)}rem` }}
                >
                  <BudgetColGroup yearCount={data.years.length} />
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 font-semibold">
                        Line item
                      </th>
                      <th
                        className="sticky z-20 border-r border-slate-200 bg-slate-50 px-2 py-3 text-center font-semibold"
                        style={stickyLinearStyle()}
                        title={LINEARITY_HEADER_TITLE}
                      >
                        Linear
                      </th>
                      {data.years.map((year) => (
                        <th
                          key={year}
                          className="px-4 py-3 font-semibold"
                          colSpan={2}
                        >
                          {formatFiscalYearLabel(year)}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2 font-medium">
                        {" "}
                      </th>
                      <th
                        className="sticky z-20 border-r border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-slate-400"
                        style={stickyLinearStyle()}
                        title={LINEARITY_HEADER_TITLE}
                      >
                        Fit
                      </th>
                      {data.years.map((year) => (
                        <YearSubHeads key={year} />
                      ))}
                    </tr>
                  </thead>
                </table>
              </div>
              <div
                ref={bodyScrollRef}
                onScroll={() => syncHorizontalScroll("body")}
                className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
              >
                <table
                  className="table-fixed border-separate border-spacing-0 text-left text-sm"
                  style={{ width: `${tableWidthRem(data.years.length)}rem` }}
                >
                  <BudgetColGroup yearCount={data.years.length} />
                  <tbody>
                    {groupedLines.map(([category, lines]) => (
                      <CategoryRows
                        key={category}
                        category={category}
                        lines={lines}
                        years={data.years}
                        selectedCode={
                          lineDetailOpen && selection.type === "line"
                            ? selectedLine?.code
                            : undefined
                        }
                        selectedCategory={
                          lineDetailOpen ? selectedCategory : undefined
                        }
                        onSelect={openLineDetail}
                        onSelectCategory={openCategoryDetail}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {lineDetailOpen && (selectedLine || selectedCategory) ? (
              <aside
                className="ml-3 flex w-[min(26rem,42%)] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                aria-labelledby="budget-line-detail-title"
              >
                <header className="flex shrink-0 items-start gap-2 border-b border-slate-100 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setLineDetailOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    aria-label="Close plot"
                  >
                    <ClosePanelIcon />
                  </button>
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-500">
                      {plotEyebrow}
                    </p>
                    <h2
                      id="budget-line-detail-title"
                      className="text-base font-semibold text-slate-900"
                    >
                      {plotTitle}
                    </h2>
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <BudgetLineChart
                    heightClass="h-64"
                    data={lineSeries}
                    series={[
                      { key: "budgeted", label: "Budgeted", color: "#0369a1" },
                      {
                        key: "actual",
                        label: "Actual (projected)",
                        color: "#7c3aed",
                        dashed: true,
                      },
                    ]}
                  />
                </div>
              </aside>
            ) : null}
          </div>
        )
      ) : null}

      </div>

      <EmailAttachmentViewerDialog
        open={preview != null}
        attachment={preview}
        onClose={() => setPreview(null)}
        previewOnly
      />
    </section>
  );
}

function BudgetTabStrip({
  active,
  onChange,
}: {
  active: BudgetTabId;
  onChange: (tab: BudgetTabId) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Budget views"
    >
      {BUDGET_TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function BudgetColGroup({ yearCount }: { yearCount: number }) {
  return (
    <colgroup>
      <col style={{ width: `${LINE_COL_REM}rem` }} />
      <col style={{ width: `${LINEAR_COL_REM}rem` }} />
      {Array.from({ length: yearCount * 2 }, (_, index) => (
        <col key={index} style={{ width: `${AMOUNT_COL_REM}rem` }} />
      ))}
    </colgroup>
  );
}

function EmptyBudgetFigures() {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
      Budget figures appear here after a package PDF has been parsed to
      Markdown. Documents can still be previewed on the Documents tab.
    </p>
  );
}

function YearSubHeads() {
  return (
    <>
      <th className="px-4 py-2 font-medium text-slate-400">Budgeted</th>
      <th className="px-4 py-2 font-medium text-slate-400">Actual</th>
    </>
  );
}

function CategoryRows({
  category,
  lines,
  years,
  selectedCode,
  selectedCategory,
  onSelect,
  onSelectCategory,
}: {
  category: string;
  lines: BudgetLineItem[];
  years: number[];
  selectedCode?: string;
  selectedCategory?: string;
  onSelect: (code: string) => void;
  onSelectCategory: (category: string) => void;
}) {
  const categorySelected = category === selectedCategory;
  return (
    <>
      <tr
        className={`group/cat cursor-pointer ${
          categorySelected ? "bg-teal-50" : "bg-slate-50 hover:bg-teal-50"
        }`}
        onClick={() => onSelectCategory(category)}
      >
        <td
          className={`sticky left-0 z-10 border-t border-r border-slate-100 px-0 text-xs font-semibold uppercase tracking-wide ${
            categorySelected
              ? "bg-teal-50 text-teal-800"
              : "bg-slate-50 text-slate-500 group-hover/cat:bg-teal-50 group-hover/cat:text-teal-800"
          }`}
          colSpan={2}
        >
          <button
            type="button"
            className="w-full px-4 py-2 text-left"
            onClick={(event) => {
              event.stopPropagation();
              onSelectCategory(category);
            }}
          >
            {category}
          </button>
        </td>
        <td
          className={`border-t border-slate-100 ${
            categorySelected
              ? "bg-teal-50"
              : "bg-slate-50 group-hover/cat:bg-teal-50"
          }`}
          colSpan={years.length * 2}
        />
      </tr>
      {lines.map((line) => {
        const selected = line.code === selectedCode;
        return (
          <tr
            key={line.code}
            className={`group cursor-pointer ${
              selected ? "bg-teal-50" : "bg-white hover:bg-teal-50"
            }`}
            onClick={() => onSelect(line.code)}
          >
            <td
              className={`sticky left-0 z-10 border-t border-slate-100 px-0 font-medium text-slate-900 ${
                selected ? "bg-teal-50" : "bg-white group-hover:bg-teal-50"
              }`}
            >
              <button
                type="button"
                className="w-full px-4 py-2 text-left"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(line.code);
                }}
              >
                <span className="mr-2 font-mono text-xs text-slate-500">
                  {line.code}
                </span>
                {line.name}
              </button>
            </td>
            <LinearityCell
              line={line}
              years={years}
              selected={selected}
            />
            {years.map((year) => (
              <YearCells
                key={year}
                budgeted={line.byYear[year]?.budgeted ?? null}
                actual={line.byYear[year]?.actual ?? null}
              />
            ))}
          </tr>
        );
      })}
    </>
  );
}

function LinearityCell({
  line,
  years,
  selected,
}: {
  line: BudgetLineItem;
  years: number[];
  selected: boolean;
}) {
  const score = lineItemLinearity(line, years);
  const label = score ? formatLinearityPercent(score.score) : "—";
  const title = score
    ? `${formatLinearityPercent(score.score)} on ${score.field} (${score.pointCount} years). 100% means the points sit on a straight line.`
    : "Needs three years of figures";
  return (
    <td
      className={`sticky z-10 border-t border-r border-slate-100 px-2 py-2 text-center tabular-nums ${
        selected ? "bg-teal-50" : "bg-white group-hover:bg-teal-50"
      } ${score ? linearityToneClass(score.score) : "text-slate-400"}`}
      style={stickyLinearStyle()}
      title={title}
    >
      {label}
    </td>
  );
}

function YearCells({
  budgeted,
  actual,
}: {
  budgeted: number | null;
  actual: number | null;
}) {
  return (
    <>
      <td className="border-t border-slate-100 px-4 py-2 tabular-nums text-slate-700">
        {budgeted == null ? "—" : formatCad(budgeted)}
      </td>
      <td className="border-t border-slate-100 px-4 py-2 tabular-nums text-slate-700">
        {actual == null ? "—" : formatCad(actual)}
      </td>
    </>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function BudgetLineChart({
  data,
  series,
  heightClass = "h-80",
}: {
  data: Array<Record<string, string | number | null>>;
  series: Array<{
    key: string;
    label: string;
    color: string;
    dashed?: boolean;
  }>;
  heightClass?: string;
}) {
  return (
    <div className={`w-full ${heightClass}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="yearLabel" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(value: number) => compactCad(value)}
            width={64}
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? formatCad(value) : "—"
            }
          />
          <Legend />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              strokeDasharray={item.dashed ? "6 4" : undefined}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
