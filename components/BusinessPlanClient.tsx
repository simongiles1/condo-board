"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatFiscalYearLabel } from "@/lib/budget/classify-documents";
import {
  BUDGET_CATEGORIES,
  BUSINESS_PLAN_SOURCE,
  GUARDRAILS,
  NETWORK_EFFECTS,
  NETWORK_STEPS,
  PRICING,
  RATE_JUSTIFICATION,
  SAVINGS_RATES,
  THIS_BUILDING_NAME,
  THIS_BUILDING_UNITS,
  VALUE_TIERS,
  impactClaimedValueUsd,
  impactSpendUsd,
  roiMultiple,
  scaleFromThisBuilding,
  scaledSpendUsd,
  tierValueUsd,
  totalValueUsd,
  type BudgetImpactId,
  type BusinessPlanBudgetSnapshot,
  type PotentialLevel,
  type ScenarioId,
  type ValueDriverId,
} from "@/lib/business-plan/content";

type ViewId = "value" | "budget" | "network" | "guardrails";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "value", label: "ROI model" },
  { id: "budget", label: "Budget impact" },
  { id: "network", label: "Network effects" },
  { id: "guardrails", label: "Guardrails" },
];

const POTENTIAL_TONE: Record<PotentialLevel, string> = {
  none: "bg-slate-100 text-slate-700 ring-slate-200",
  low: "bg-amber-50 text-amber-900 ring-amber-200",
  high: "bg-teal-50 text-teal-900 ring-teal-200",
  extreme: "bg-emerald-50 text-emerald-900 ring-emerald-200",
};

function formatUsd(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1_000) {
    const thousands = value / 1_000;
    const digits = Number.isInteger(thousands) ? 0 : 1;
    return `$${thousands.toFixed(digits)}k`;
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMultiple(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}x`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function sourceLabel(snapshot: BusinessPlanBudgetSnapshot): string {
  if (snapshot.fiscalYearStart == null || snapshot.amountField == null) {
    return `${snapshot.corporation} operating budget not extracted yet`;
  }
  const year = formatFiscalYearLabel(snapshot.fiscalYearStart);
  const field = snapshot.amountField === "budgeted" ? "budgeted" : "actual";
  return `${snapshot.corporation} FY ${year} ${field} · ${snapshot.sourceUnits} units`;
}

export function BusinessPlanClient({
  snapshot,
  showPricingRoi = false,
}: {
  snapshot: BusinessPlanBudgetSnapshot;
  showPricingRoi?: boolean;
}) {
  const [view, setView] = useState<ViewId>("value");
  const [scenario, setScenario] = useState<ScenarioId>("full");
  const [units, setUnits] = useState(THIS_BUILDING_UNITS);
  const [priceUsd, setPriceUsd] = useState<number>(PRICING.lowUsd);
  const [openCategory, setOpenCategory] = useState<string>("equipment");

  const annualValue = useMemo(
    () => totalValueUsd(scenario, units, snapshot),
    [scenario, units, snapshot],
  );
  const conservativeValue = useMemo(
    () => totalValueUsd("conservative", units, snapshot),
    [units, snapshot],
  );
  const fullValue = useMemo(
    () => totalValueUsd("full", units, snapshot),
    [units, snapshot],
  );
  const roi = roiMultiple(annualValue, priceUsd);
  const thisBuilding = units === THIS_BUILDING_UNITS;
  const hasBooks = snapshot.fiscalYearStart != null;

  return (
    <section className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-8">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
          Insights · value proposition
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Business Plan</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          The product thesis for other buildings, with every dollar band
          grounded in {THIS_BUILDING_NAME}&apos;s own operating budget. Network
          effects still matter; the single-player ROI is no longer a 250-unit
          memo estimate.
        </p>
      </header>

      <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <span className="font-semibold">{sourceLabel(snapshot)}</span>
        {hasBooks ? (
          <>
            . Rates from the value memo applied to those GL lines.{" "}
            <Link
              href="/building/budget"
              className="font-semibold text-teal-900 underline decoration-teal-400 underline-offset-2 hover:text-teal-700"
            >
              Open Budget &amp; Financials
            </Link>
          </>
        ) : (
          <>
            . Extract an operating-budget package on{" "}
            <Link
              href="/building/budget"
              className="font-semibold text-teal-900 underline decoration-teal-400 underline-offset-2 hover:text-teal-700"
            >
              Budget &amp; Financials
            </Link>{" "}
            to replace placeholder zeros.
          </>
        )}
      </p>

      <div
        className={`grid gap-3 ${showPricingRoi ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}
      >
        <HeroStat
          label="Net annual value"
          value={formatUsd(annualValue, true)}
          hint={
            thisBuilding
              ? `${formatUsd(conservativeValue)} – ${formatUsd(fullValue)} on this building`
              : `Scaled from ${THIS_BUILDING_UNITS} units · ${formatUsd(conservativeValue)} – ${formatUsd(fullValue)}`
          }
          emphasis
        />
        {showPricingRoi ? (
          <>
            <HeroStat
              label="SaaS price / building"
              value={formatUsd(priceUsd, true)}
              hint={`${formatUsd(PRICING.lowUsd)} – ${formatUsd(PRICING.highUsd)} target`}
            />
            <HeroStat
              label="Board ROI"
              value={formatMultiple(roi)}
              hint="Documented target is 10x–20x"
              emphasis
            />
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end">
        <fieldset className="min-w-0 flex-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Scenario
          </legend>
          <div
            className="mt-2 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
            role="group"
            aria-label="ROI scenario"
          >
            {(
              [
                ["conservative", "Conservative"],
                ["full", "Full potential"],
              ] as const
            ).map(([id, label]) => {
              const selected = scenario === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setScenario(id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    selected
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="min-w-0 flex-1 space-y-1">
          <span className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
            Building size
            <span className="font-semibold tabular-nums text-slate-900">
              {units} units
            </span>
          </span>
          <input
            type="range"
            min={50}
            max={600}
            step={1}
            value={units}
            onChange={(event) => setUnits(Number(event.target.value))}
            className="w-full accent-teal-700"
          />
          <button
            type="button"
            onClick={() => setUnits(THIS_BUILDING_UNITS)}
            className={`text-xs font-semibold ${
              thisBuilding
                ? "text-teal-800"
                : "text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-teal-800"
            }`}
          >
            {THIS_BUILDING_NAME} is {THIS_BUILDING_UNITS} units
          </button>
        </label>

        {showPricingRoi ? (
          <label className="min-w-0 flex-1 space-y-1">
            <span className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              Annual subscription
              <span className="font-semibold tabular-nums text-slate-900">
                {formatUsd(priceUsd)}
              </span>
            </span>
            <input
              type="range"
              min={PRICING.lowUsd}
              max={PRICING.highUsd}
              step={500}
              value={priceUsd}
              onChange={(event) => setPriceUsd(Number(event.target.value))}
              className="w-full accent-teal-700"
            />
          </label>
        ) : null}
      </div>

      {thisBuilding ? (
        <p className="text-xs text-slate-500">
          Dollar amounts are this building&apos;s latest operating-budget lines
          times the documented savings rates. The unit slider is for other
          buildings; it scales linearly from {THIS_BUILDING_UNITS}.
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          {units} units is {scaleLabel(units)} of this {THIS_BUILDING_UNITS}-unit
          building. That is a working assumption so you can size a pitch — not a
          second study.
        </p>
      )}

      <div
        className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1"
        role="tablist"
        aria-label="Business plan sections"
      >
        {VIEWS.map((tab) => {
          const selected = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setView(tab.id)}
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

      {view === "value" ? (
        <ValueView
          scenario={scenario}
          units={units}
          annualValue={annualValue}
          priceUsd={priceUsd}
          snapshot={snapshot}
          showPricingRoi={showPricingRoi}
        />
      ) : null}
      {view === "budget" ? (
        <BudgetView
          openId={openCategory}
          onToggle={(id) =>
            setOpenCategory((current) => (current === id ? "" : id))
          }
          scenario={scenario}
          units={units}
          snapshot={snapshot}
        />
      ) : null}
      {view === "network" ? <NetworkView /> : null}
      {view === "guardrails" ? <GuardrailsView /> : null}

      <p className="text-xs text-slate-400">
        Thesis: {BUSINESS_PLAN_SOURCE}. Numbers: Budget &amp; Financials.
      </p>
    </section>
  );
}

function scaleLabel(units: number): string {
  const scale = units / THIS_BUILDING_UNITS;
  return `${scale.toFixed(2).replace(/\.?0+$/, "")}×`;
}

function booksFieldLabel(snapshot: BusinessPlanBudgetSnapshot): string {
  if (snapshot.fiscalYearStart == null || snapshot.amountField == null) {
    return "no extracted operating budget yet";
  }
  const year = formatFiscalYearLabel(snapshot.fiscalYearStart);
  const field = snapshot.amountField === "budgeted" ? "budgeted" : "actual";
  return `${THIS_BUILDING_NAME} FY ${year} ${field}`;
}

function glCodeList(codes: string[]): string {
  if (codes.length === 0) return "no matching GLs";
  return codes.map((code) => code).join(", ");
}

function FormulaEquation({
  rateValue,
  rateLabel,
  otherRateHint,
  spendValue,
  spendLabel,
  scaleValue,
  resultValue,
  resultLabel,
  origin,
  justification,
}: {
  rateValue: string;
  rateLabel: string;
  otherRateHint: string | null;
  spendValue: string | null;
  spendLabel: string;
  scaleValue: string | null;
  resultValue: string;
  resultLabel: string;
  origin: string;
  justification: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <EquationTerm
          label={rateLabel}
          value={rateValue}
          tone="variable"
          hint={otherRateHint}
        />
        {spendValue ? (
          <>
            <EquationOp>×</EquationOp>
            <EquationTerm label={spendLabel} value={spendValue} tone="input" />
          </>
        ) : null}
        {scaleValue ? (
          <>
            <EquationOp>×</EquationOp>
            <EquationTerm
              label="Size scale"
              value={scaleValue}
              tone="input"
            />
          </>
        ) : null}
        <EquationOp>=</EquationOp>
        <EquationTerm label={resultLabel} value={resultValue} tone="result" />
      </div>
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-slate-700">
        <p>
          <span className="font-semibold text-slate-900">
            Where the rate comes from.{" "}
          </span>
          {origin}
        </p>
        <p>
          <span className="font-semibold text-slate-900">What justifies it. </span>
          {justification}
        </p>
      </div>
    </div>
  );
}

function EquationTerm({
  label,
  value,
  tone,
  hint = null,
}: {
  label: string;
  value: string;
  tone: "variable" | "input" | "result";
  hint?: string | null;
}) {
  const box =
    tone === "variable"
      ? "border-teal-400 bg-teal-50 text-teal-950 ring-2 ring-teal-200"
      : tone === "result"
        ? "border-teal-200 bg-white text-teal-900"
        : "border-slate-200 bg-white text-slate-900";
  return (
    <span className="inline-flex min-w-[8.5rem] flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={`mt-1 rounded-xl border px-3 py-2 text-2xl font-semibold tabular-nums tracking-tight ${box}`}
      >
        {value}
      </span>
      {hint ? (
        <span className="mt-1 max-w-[14rem] text-xs leading-snug text-slate-500">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

function EquationOp({ children }: { children: string }) {
  return (
    <span className="mb-2 px-0.5 text-2xl font-semibold text-slate-400">
      {children}
    </span>
  );
}

function SumFormula({
  parts,
  total,
  note,
}: {
  parts: string[];
  total: string;
  note: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
        {parts.join(" + ")} = {total}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{note}</p>
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        emphasis
          ? "border-teal-200 bg-teal-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${
          emphasis ? "text-teal-900" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </div>
  );
}

function ValueView({
  scenario,
  units,
  annualValue,
  priceUsd,
  snapshot,
  showPricingRoi,
}: {
  scenario: ScenarioId;
  units: number;
  annualValue: number;
  priceUsd: number;
  snapshot: BusinessPlanBudgetSnapshot;
  showPricingRoi: boolean;
}) {
  const maxBar = Math.max(
    ...VALUE_TIERS.map((tier) =>
      tierValueUsd(tier.id, "full", units, snapshot),
    ),
    1,
  );
  const roi = roiMultiple(annualValue, priceUsd);
  const books = booksFieldLabel(snapshot);
  const scale = scaleFromThisBuilding(units);

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Value hierarchy · {units}-unit condo
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Equipment and procurement is the goldmine. Staffing, preventative
          maintenance, and reserve-fund accuracy stack on top of it.
        </p>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            How every dollar is calculated
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Spend comes from {books} — the same extract as{" "}
              <Link
                href="/building/budget"
                className="font-medium text-teal-800 underline decoration-teal-300 underline-offset-2"
              >
                Budget &amp; Financials
              </Link>
              .
            </li>
            <li>
              Each tier multiplies that spend by a memo rate (
              {scenario === "conservative" ? "Conservative" : "Full potential"}{" "}
              is selected above). Rates are assumptions, not measured savings.
            </li>
            <li>
              {units === THIS_BUILDING_UNITS ? (
                <>
                  Size scale is 1 because the slider is on this building (
                  {THIS_BUILDING_UNITS} units).
                </>
              ) : (
                <>
                  Size scale is {units}/{THIS_BUILDING_UNITS} ={" "}
                  {scale.toFixed(2)} so you can pitch a {units}-unit building
                  from these books. That is a working assumption, not a second
                  study.
                </>
              )}
            </li>
          </ol>
        </div>

        <ul className="mt-5 space-y-6">
          {VALUE_TIERS.map((tier) => {
            const value = tierValueUsd(tier.id, scenario, units, snapshot);
            const width = Math.max(8, (value / maxBar) * 100);
            const homeSpend = tierSpendBase(tier.id, snapshot);
            const copy = RATE_JUSTIFICATION[tier.id];
            const scaleValue =
              units === THIS_BUILDING_UNITS
                ? null
                : `${units}/${THIS_BUILDING_UNITS}`;
            const spendLabel =
              tier.id === "staffing"
                ? "This building · PM fees"
                : tier.id === "reserve"
                  ? "Consulting assumption"
                  : "This building · equipment spend";
            return (
              <li key={tier.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Tier {tier.tier}
                    </span>
                    {tier.category}
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-teal-800">
                    {formatUsd(value)}
                    <span className="ml-2 text-xs font-medium text-slate-500">
                      / year
                    </span>
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{tier.mechanism}</p>
                {tier.id === "reserve" ? (
                  <FormulaEquation
                    rateValue={formatUsd(
                      SAVINGS_RATES.reserveConsultingUsd[scenario],
                    )}
                    rateLabel="Assumption · variable"
                    otherRateHint={null}
                    spendValue={null}
                    spendLabel=""
                    scaleValue={scaleValue}
                    resultValue={formatUsd(value)}
                    resultLabel="Claimed / year"
                    origin={copy.origin}
                    justification={copy.justification}
                  />
                ) : (
                  <FormulaEquation
                    rateValue={formatPercent(SAVINGS_RATES[tier.id][scenario])}
                    rateLabel="Assumption · variable"
                    otherRateHint={null}
                    spendValue={formatUsd(homeSpend)}
                    spendLabel={spendLabel}
                    scaleValue={scaleValue}
                    resultValue={formatUsd(value)}
                    resultLabel="Claimed / year"
                    origin={copy.origin}
                    justification={copy.justification}
                  />
                )}
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-600"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              Net annual value generated
            </p>
            <p className="text-2xl font-semibold tabular-nums text-teal-900">
              {formatUsd(annualValue)}
              <span className="ml-2 text-sm font-medium text-slate-500">
                / year
              </span>
            </p>
          </div>
          <SumFormula
            parts={VALUE_TIERS.map((tier) =>
              formatUsd(tierValueUsd(tier.id, scenario, units, snapshot)),
            )}
            total={formatUsd(annualValue)}
            note={
              showPricingRoi
                ? `Board ROI at the selected subscription: ${formatUsd(annualValue)} ÷ ${formatUsd(priceUsd)} = ${formatMultiple(roi)}.`
                : `Sum of all tier claims at the selected scenario and building size.`
            }
          />
        </div>
      </article>

      {showPricingRoi ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
          At{" "}
          <strong>
            {formatUsd(PRICING.lowUsd)} – {formatUsd(PRICING.highUsd)}
          </strong>{" "}
          per building, the documented target is a{" "}
          <strong>10x to 20x ROI</strong> for the condominium corporation.
        </p>
      ) : null}
    </div>
  );
}

function tierSpendBase(
  id: ValueDriverId,
  snapshot: BusinessPlanBudgetSnapshot,
): number {
  if (id === "staffing") return impactSpendUsd(snapshot, "property-management");
  if (id === "reserve") return impactSpendUsd(snapshot, "reserve");
  return impactSpendUsd(snapshot, "equipment");
}

function BudgetView({
  openId,
  onToggle,
  scenario,
  units,
  snapshot,
}: {
  openId: string;
  onToggle: (id: string) => void;
  scenario: ScenarioId;
  units: number;
  snapshot: BusinessPlanBudgetSnapshot;
}) {
  const books = booksFieldLabel(snapshot);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Residential condo budgets are dominated by five operating categories.
        Spend is this building&apos;s books. Claimed savings is a memo rate on
        that spend — or $0 where software cannot cut an SLA.
      </p>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          How spend and claimed savings are calculated
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Each card sums the matching GL lines from {books} (same extract as
            Budget &amp; Financials). Open a card for the line list.
          </li>
          <li>
            Cleaning and security are shown for scale and then excluded from
            hard ROI. PM uses 10%/20% of fees. Equipment uses 15%+5%
            conservative or 25%+10% full (the memo&apos;s 15–35% band). Reserve
            claimed is consulting dollars, not a cut to the contribution.
          </li>
          <li>
            {units === THIS_BUILDING_UNITS ? (
              <>
                Displayed spend is unscaled — the slider is on this{" "}
                {THIS_BUILDING_UNITS}-unit building.
              </>
            ) : (
              <>
                Displayed spend and claimed amounts are multiplied by {units}/
                {THIS_BUILDING_UNITS} to size a {units}-unit pitch.
              </>
            )}
          </li>
        </ol>
      </div>
      {BUDGET_CATEGORIES.map((category) => {
        const open = openId === category.id;
        const impactId = category.id as BudgetImpactId;
        const impact = snapshot.impacts.find((item) => item.id === impactId);
        const homeSpend = impact?.spendUsd ?? 0;
        const spend = scaledSpendUsd(homeSpend, units);
        const claimed = impactClaimedValueUsd(
          impactId,
          scenario,
          units,
          snapshot,
        );
        return (
          <article
            key={category.id}
            className={`rounded-2xl border bg-white shadow-sm ${
              category.potential === "extreme"
                ? "border-teal-300"
                : "border-slate-200"
            }`}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(category.id)}
              className="flex w-full items-start gap-4 px-5 py-4 text-left"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                {category.letter}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-slate-900">
                    {category.title}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${POTENTIAL_TONE[category.potential]}`}
                  >
                    {category.potentialLabel}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="text-slate-600">
                    Spend{" "}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {formatUsd(spend)}
                    </span>
                  </span>
                  {claimed > 0 ? (
                    <span className="text-lg font-semibold tabular-nums text-teal-800">
                      {formatUsd(claimed)}
                      <span className="ml-1 text-xs font-medium text-slate-500">
                        claimed / year
                      </span>
                    </span>
                  ) : category.id === "security" ? (
                    <span className="text-sm text-slate-500">
                      No hard-monetary ROI · liability reduction only
                    </span>
                  ) : (
                    <span className="text-sm text-slate-500">
                      No hard-monetary ROI
                    </span>
                  )}
                </span>
              </span>
              <span className="mt-1 text-xs font-medium text-slate-400">
                {open ? "Hide lines" : "Show lines"}
              </span>
            </button>
            <div className="border-t border-slate-100 px-5 py-3">
              <BudgetImpactEquation
                id={impactId}
                scenario={scenario}
                units={units}
                homeSpend={homeSpend}
                claimed={claimed}
                codes={impact?.lines.map((line) => line.code) ?? []}
              />
            </div>
            {open ? (
              <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                {impact && impact.lines.length > 0 ? (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {impact.lines.map((line) => (
                      <li
                        key={line.code}
                        className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 text-slate-700">
                          <span className="font-mono text-xs text-slate-400">
                            {line.code}
                          </span>{" "}
                          {line.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-900">
                          {formatUsd(scaledSpendUsd(line.amountUsd, units))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    No matching GL lines in the latest extracted budget.
                  </p>
                )}
                <p className="text-sm text-slate-700">{category.reality}</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {category.focus.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function BudgetImpactEquation({
  id,
  scenario,
  units,
  homeSpend,
  claimed,
  codes,
}: {
  id: BudgetImpactId;
  scenario: ScenarioId;
  units: number;
  homeSpend: number;
  claimed: number;
  codes: string[];
}) {
  const gls = glCodeList(codes);
  const scaleValue =
    units === THIS_BUILDING_UNITS ? null : `${units}/${THIS_BUILDING_UNITS}`;

  if (id === "cleaning") {
    return (
      <FormulaEquation
        rateValue="0%"
        rateLabel="Assumption · locked"
        otherRateHint="Not driven by the toggle."
        spendValue={formatUsd(homeSpend)}
        spendLabel="This building · cleaning GLs"
        scaleValue={scaleValue}
        resultValue={formatUsd(claimed)}
        resultLabel="Claimed / year"
        origin={`The memo (section A) sets cleaning cost-reduction at negligible/zero. Spend is GLs ${gls} from this building’s books.`}
        justification="Cleaning is a fixed-hour SLA. Software cannot cut contract hours without hurting cleanliness, so the rate stays 0% in both Conservative and Full potential."
      />
    );
  }
  if (id === "security") {
    return (
      <FormulaEquation
        rateValue="0%"
        rateLabel="Assumption · locked"
        otherRateHint="Not driven by the toggle."
        spendValue={formatUsd(homeSpend)}
        spendLabel="This building · security GLs"
        scaleValue={scaleValue}
        resultValue={formatUsd(claimed)}
        resultLabel="Claimed / year"
        origin={`The memo (section B) rates security as low/indirect. Spend is GLs ${gls}.`}
        justification="Concierge and escort contracts are hourly SLAs. The memo’s value is incident/liability reduction (faster shut-offs, fewer deductibles), not a rate cut on those hours."
      />
    );
  }
  if (id === "property-management") {
    const copy = RATE_JUSTIFICATION.staffing;
    return (
      <FormulaEquation
        rateValue={formatPercent(SAVINGS_RATES.staffing[scenario])}
        rateLabel="Assumption · variable"
        otherRateHint={null}
        spendValue={formatUsd(homeSpend)}
        spendLabel="This building · PM fees"
        scaleValue={scaleValue}
        resultValue={formatUsd(claimed)}
        resultLabel="Claimed / year"
        origin={`${copy.origin} GLs ${gls}.`}
        justification={copy.justification}
      />
    );
  }
  if (id === "equipment") {
    const procurement = SAVINGS_RATES.equipment[scenario];
    const preventative = SAVINGS_RATES.preventative[scenario];
    return (
      <FormulaEquation
        rateValue={formatPercent(procurement + preventative)}
        rateLabel="Assumption · variable"
        otherRateHint={`${formatPercent(procurement)} procurement + ${formatPercent(preventative)} preventative.`}
        spendValue={formatUsd(homeSpend)}
        spendLabel="This building · equipment spend"
        scaleValue={scaleValue}
        resultValue={formatUsd(claimed)}
        resultLabel="Claimed / year"
        origin={`This card combines ROI Tiers 1 and 3. ${RATE_JUSTIFICATION.equipment.origin}`}
        justification={`${RATE_JUSTIFICATION.equipment.justification} Preventative (${formatPercent(preventative)}) is the remainder of the 15–35% band. GLs ${gls}.`}
      />
    );
  }
  const copy = RATE_JUSTIFICATION.reserve;
  return (
    <FormulaEquation
      rateValue={formatUsd(SAVINGS_RATES.reserveConsultingUsd[scenario])}
      rateLabel="Assumption · variable"
      otherRateHint={null}
      spendValue={null}
      spendLabel=""
      scaleValue={scaleValue}
      resultValue={formatUsd(claimed)}
      resultLabel="Claimed / year"
      origin={`${copy.origin} Contribution GLs ${gls} are context only and are not multiplied.`}
      justification={copy.justification}
    />
  );
}

function NetworkView() {
  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Bloomberg Terminal for condo boards
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          One building is a utility. Many buildings become a decentralized
          procurement intelligence network. {THIS_BUILDING_NAME} is the
          single-player proof; the slider above is how the same thesis sizes
          for the next corporation.
        </p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {NETWORK_STEPS.map((step, index) => (
            <li
              key={step.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                {index + 1}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {step.title}
              </p>
              <p className="mt-1 text-sm text-slate-600">{step.detail}</p>
            </li>
          ))}
        </ol>
      </article>

      {NETWORK_EFFECTS.map((effect) => (
        <article
          key={effect.id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h3 className="text-base font-semibold text-slate-900">
            {effect.title}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {effect.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {effect.quote && effect.quoteHighlight ? (
            <blockquote className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
              <p className="text-sm italic text-teal-950">{effect.quote}</p>
              <p className="mt-3 flex flex-wrap gap-4 text-sm">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Regional average
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-teal-900">
                    {formatUsd(effect.quoteHighlight.fair)}
                  </span>
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Your quote
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-red-800">
                    {formatUsd(effect.quoteHighlight.quoted)}
                  </span>
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Overpay
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-red-800">
                    {formatUsd(
                      effect.quoteHighlight.quoted - effect.quoteHighlight.fair,
                    )}
                  </span>
                </span>
              </p>
            </blockquote>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function GuardrailsView() {
  return (
    <ol className="space-y-3">
      {GUARDRAILS.map((rule, index) => (
        <li
          key={rule.id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            Rule {index + 1}
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">
            {rule.title}
          </h3>
          <p className="mt-2 text-sm text-slate-700">{rule.body}</p>
        </li>
      ))}
    </ol>
  );
}
