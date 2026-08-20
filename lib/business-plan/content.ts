/** Structured copy of `.doc/business-ase-and-value-proposition.md` for the super-admin view. */

export const BUSINESS_PLAN_SOURCE = ".doc/business-ase-and-value-proposition.md";

/** Studio on Richmond / TSCC 2517. Other building sizes scale from this. */
export const THIS_BUILDING_UNITS = 333;
export const THIS_BUILDING_NAME = "TSCC 2517";

export const PRICING = {
  lowUsd: 3_000,
  highUsd: 6_000,
} as const;

/**
 * Rates applied to this building's latest operating-budget GL, not the
 * memo's 250-unit dollar bands. Equipment + preventative stay inside the
 * documented 15%–35% repair/replacement range.
 */
export const SAVINGS_RATES = {
  staffing: { conservative: 0.1, full: 0.2 },
  equipment: { conservative: 0.15, full: 0.25 },
  preventative: { conservative: 0.05, full: 0.1 },
  reserveConsultingUsd: { conservative: 5_000, full: 10_000 },
} as const;

/** Why each assumption exists. Spend is from the books; these rates are not. */
export const RATE_JUSTIFICATION: Record<
  ValueDriverId,
  { origin: string; justification: string }
> = {
  equipment: {
    origin:
      "Section D of the value memo states a 15–35% reduction on repair/replacement spend. Conservative uses the 15% floor as the procurement/markup slice. Full potential uses 25%, with Preventative (Tier 3) taking the leftover 5% or 10% so the two tiers still sum to 20% or 35%.",
    justification:
      "The memo’s mechanisms are catching 200%+ contractor markups via OEM spec matching, closed “approved vendor” lists that invite bid-rigging (Competition Bureau Canada has targeted condo refurbishment), and premature pump/boiler/chiller failure from poor install or servicing. That is a working claim until this building’s invoices prove a measured rate.",
  },
  staffing: {
    origin:
      "The memo’s board-side saving is $15,000–$30,000/year from renegotiating assistant-PM hours or the management fee. Against this building’s GL 5510 that maps to 10% conservative / 20% full.",
    justification:
      "On-site staffing (full-time assistant PM plus a share of the PM) is a large, negotiable line. Automating inquiries, document lookup, and task tracking is what the memo says lets a board cut those hours or the fee. It is an assumption about a future negotiation, not a booked cut.",
  },
  preventative: {
    origin:
      "The memo’s Tier 3 band ($10k–$20k on a 250-unit model) sits on top of procurement. We encode it as 5% conservative / 10% full of the same repairs+HVAC spend so Equipment + Preventative stay inside the 15–35% band and we do not invent a second maintenance budget.",
    justification:
      "The mechanism is eliminating repeat repairs by isolating root causes — the same premature-failure story as Tier 1, just the servicing half rather than the markup half. Same denominator as Equipment on purpose.",
  },
  reserve: {
    origin:
      "The memo’s Tier 4 band is $5,000–$10,000/year for a typical building. Conservative is $5,000 and Full potential is $10,000 at this building’s 333 units, then scaled. It is not a percentage of the reserve contribution.",
    justification:
      "Reserve Fund Studies are done by independent engineers who default to conservative replacement timelines. The memo’s value is complete asset provenance (less billable document-hunting, fewer blind depreciation assumptions) — consulting efficiency, not a cut to the contribution itself.",
  },
};

export type ValueDriverId = "equipment" | "staffing" | "preventative" | "reserve";

export type BudgetImpactId =
  | "cleaning"
  | "security"
  | "property-management"
  | "equipment"
  | "reserve";

export type BusinessPlanGlLine = {
  code: string;
  name: string;
  amountUsd: number;
};

export type BusinessPlanImpact = {
  id: BudgetImpactId;
  spendUsd: number;
  lines: BusinessPlanGlLine[];
  savingsRate: { conservative: number; full: number };
};

export type BusinessPlanBudgetSnapshot = {
  corporation: string;
  sourceUnits: number;
  fiscalYearStart: number | null;
  amountField: "budgeted" | "actual" | null;
  impacts: BusinessPlanImpact[];
};

export const VALUE_TIERS: ReadonlyArray<{
  id: ValueDriverId;
  tier: number;
  category: string;
  mechanism: string;
}> = [
  {
    id: "equipment",
    tier: 1,
    category: "Equipment & Procurement",
    mechanism:
      "Catching part markups, premature failure trends, and bid-rigging",
  },
  {
    id: "staffing",
    tier: 2,
    category: "PM Staffing Efficiency",
    mechanism: "Admin automation, contract hours renegotiation",
  },
  {
    id: "preventative",
    tier: 3,
    category: "Preventative Maintenance",
    mechanism: "Eliminating repeat repairs via root-cause isolation",
  },
  {
    id: "reserve",
    tier: 4,
    category: "Reserve Fund Accuracy",
    mechanism: "Asset provenance for engineering studies",
  },
];

export type PotentialLevel = "none" | "low" | "high" | "extreme";

export type BudgetCategory = {
  id: string;
  letter: string;
  title: string;
  potential: PotentialLevel;
  potentialLabel: string;
  savingsHighlight: string | null;
  reality: string;
  focus: string[];
};

export const BUDGET_CATEGORIES: BudgetCategory[] = [
  {
    id: "cleaning",
    letter: "A",
    title: "Cleaning Staff",
    potential: "none",
    potentialLabel: "Negligible / Zero",
    savingsHighlight: null,
    reality:
      "Cleaning is governed by fixed-rate hourly SLAs. Software cannot reduce contract hours without impacting facility cleanliness.",
    focus: ["Exclude from hard-monetary ROI calculations."],
  },
  {
    id: "security",
    letter: "B",
    title: "Security",
    potential: "low",
    potentialLabel: "Low / Indirect",
    savingsHighlight: "Tens of thousands in avoided deductibles",
    reality:
      "Security contracts are fixed hourly rates. Minimum-wage turnover leads to low site-specific knowledge and frequent resident complaints.",
    focus: [
      "Quality & incident mitigation: an AI-driven, site-specific knowledge base (shut-off valves, vendor emergency contacts, guest policies).",
      "Liability reduction: faster emergency response prevents catastrophic damage (for example uncontained water leaks), saving tens of thousands in insurance deductibles.",
    ],
  },
  {
    id: "property-management",
    letter: "C",
    title: "Property Management",
    potential: "high",
    potentialLabel: "High",
    savingsHighlight: null,
    reality:
      "On-site staffing (full-time Assistant PM + half-time PM) is a major line item — $55k–$70k+ annually per assistant PM.",
    focus: [
      "Board: automate inquiries, document lookup, and task management so the Board can renegotiate fees or drop a full-time assistant to part-time.",
      "Management company: one Assistant PM can oversee multiple properties without quality degradation.",
    ],
  },
  {
    id: "equipment",
    letter: "D",
    title: "Equipment & Maintenance",
    potential: "extreme",
    potentialLabel: "Extremely High · 15%–35%",
    savingsHighlight: null,
    reality:
      "Pumps, chillers, and boilers fail early from poor installation, balancing, or servicing. Closed “approved vendor” lists foster markups, kickbacks, and tender manipulation — historically targeted by the Competition Bureau Canada in condo refurbishment.",
    focus: [
      "Spec matching: extract OEM part numbers from invoices and cross-reference wholesale pricing, catching 200%+ contractor markups.",
      "Direct procurement: draft spec-accurate RFPs so Boards can invite manufacturers and bypass inflated vendor networks.",
      "Repair and replacement spend — not cleaning or security SLAs — is the primary financial goldmine.",
    ],
  },
  {
    id: "reserve",
    letter: "E",
    title: "Reserve Fund Contributions",
    potential: "high",
    potentialLabel: "Medium / Long-term",
    savingsHighlight: null,
    reality:
      "Reserve Fund Studies are legally mandated and done by independent engineers bound by professional liability. Engineers default to conservative replacement timelines.",
    focus: [
      "Complete asset provenance: an indexed history of maintenance, overhauls, and part replacements prevents blind depreciation assumptions.",
      "Fewer engineering billable hours: eliminates manual document discovery during Class 1/2 study updates.",
    ],
  },
];

export const NETWORK_STEPS = [
  {
    id: "ingest",
    title: "Building ingestion",
    detail: "Each corporation feeds its own invoices, work orders, and contracts.",
  },
  {
    id: "strip",
    title: "Anonymized stripper",
    detail:
      "Unit numbers, resident names, PM identities, and addresses are stripped before anything is shared.",
  },
  {
    id: "benchmark",
    title: "Global benchmark DB",
    detail: "Anonymized line items become a regional procurement intelligence layer.",
  },
  {
    id: "alerts",
    title: "Real-time board alerts",
    detail:
      "Boards see quote percentiles and contractor history before they sign.",
  },
] as const;

export const NETWORK_EFFECTS = [
  {
    id: "benchmarking",
    title: "Anonymized cost benchmarking",
    bullets: [
      "Compares invoice line items across regional buildings automatically.",
      "Alerts before contract signing — not after the money is gone.",
    ],
    quote:
      "3 nearby high-rises replaced this exact pump model in the last 12 months for an average of $28,500. Your quote ($45,000) is in the 90th percentile.",
    quoteHighlight: { fair: 28_500, quoted: 45_000 },
  },
  {
    id: "postmortems",
    title: "Project post-mortems & verifiable ratings",
    bullets: [
      "Cost variance: final invoice vs original tender quote.",
      "Schedule variance: agreed completion vs actual sign-off.",
      "Callback rate: warranty repair tickets within 90 days.",
    ],
    quote: null,
    quoteHighlight: null,
  },
  {
    id: "coop",
    title: "Aggregated demand & group purchasing",
    bullets: [
      "Finds regional clusters of upcoming capital work (for example 5 buildings within 3 km planning elevator or chiller overhauls in 18 months).",
      "Aggregates RFP demand for bulk-volume discounts with manufacturers and primary contractors.",
    ],
    quote: null,
    quoteHighlight: null,
  },
] as const;

export const GUARDRAILS = [
  {
    id: "objective",
    title: "Objective metrics over subjective reviews",
    body: "Store and display hard, verifiable data from invoices and contracts (price-per-square-foot, deadline variance). Do not host unverified open-text star ratings that expose the platform to defamation risk.",
  },
  {
    id: "privacy",
    title: "Differential privacy by default",
    body: "Strip unit numbers, resident names, property manager identities, and specific building addresses before feeding cross-building benchmarking models.",
  },
  {
    id: "single-player",
    title: "Single-player utility first",
    body: "The app must deliver 10x standalone value to a single building analyzing its own history on Day 1, solving the cold-start problem before network density exists.",
  },
] as const;

export type ScenarioId = "conservative" | "full";

export function scaleFromThisBuilding(units: number): number {
  return units / THIS_BUILDING_UNITS;
}

export function impactSpendUsd(
  snapshot: BusinessPlanBudgetSnapshot,
  id: BudgetImpactId,
): number {
  return snapshot.impacts.find((impact) => impact.id === id)?.spendUsd ?? 0;
}

export function tierValueUsd(
  id: ValueDriverId,
  scenario: ScenarioId,
  units: number,
  snapshot: BusinessPlanBudgetSnapshot,
): number {
  const scale = scaleFromThisBuilding(units);
  if (id === "reserve") {
    return Math.round(SAVINGS_RATES.reserveConsultingUsd[scenario] * scale);
  }
  if (id === "staffing") {
    return Math.round(
      impactSpendUsd(snapshot, "property-management") *
        SAVINGS_RATES.staffing[scenario] *
        scale,
    );
  }
  const equipmentSpend = impactSpendUsd(snapshot, "equipment");
  const rate =
    id === "equipment"
      ? SAVINGS_RATES.equipment[scenario]
      : SAVINGS_RATES.preventative[scenario];
  return Math.round(equipmentSpend * rate * scale);
}

export function totalValueUsd(
  scenario: ScenarioId,
  units: number,
  snapshot: BusinessPlanBudgetSnapshot,
): number {
  return VALUE_TIERS.reduce(
    (sum, tier) => sum + tierValueUsd(tier.id, scenario, units, snapshot),
    0,
  );
}

export function scaledSpendUsd(spendUsd: number, units: number): number {
  return Math.round(spendUsd * scaleFromThisBuilding(units));
}

export function impactClaimedValueUsd(
  id: BudgetImpactId,
  scenario: ScenarioId,
  units: number,
  snapshot: BusinessPlanBudgetSnapshot,
): number {
  if (id === "cleaning" || id === "security") return 0;
  if (id === "reserve") {
    return tierValueUsd("reserve", scenario, units, snapshot);
  }
  if (id === "equipment") {
    return (
      tierValueUsd("equipment", scenario, units, snapshot) +
      tierValueUsd("preventative", scenario, units, snapshot)
    );
  }
  return tierValueUsd("staffing", scenario, units, snapshot);
}

export function roiMultiple(annualValueUsd: number, priceUsd: number): number {
  if (priceUsd <= 0) return 0;
  return annualValueUsd / priceUsd;
}
