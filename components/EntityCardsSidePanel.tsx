"use client";

import { useEffect } from "react";

import {
  entityCardDisplayName as contactCardDisplayName,
  type ContactEntityCard,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  entityCardDisplayName as orgCardDisplayName,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";

export type EntityCardsPanelKind = "contacts" | "organizations";

export type EntityCardFilterOption = {
  id: string;
  label: string;
};

export type EntityCardEmailOption = {
  emailId: string;
  label: string;
};

type KindDataset<TCard> = {
  cardsByOptionId: Record<string, TCard[]>;
  /**
   * When set and filter is "all", show these instead of concatenating
   * cardsByOptionId (e.g. thread-page merge pass).
   */
  preferredAllCards?: TCard[] | null;
  filterOptions: EntityCardFilterOption[];
  /** null = All */
  selectedOptionId: string | null;
  onSelectedOptionIdChange: (optionId: string | null) => void;
  modelLabel: string | null;
  emptyMessage?: string;
  allUnmergedHint?: string | null;
  allOptionLabel?: string;
};

type BaseProps = {
  open: boolean;
  onClose: () => void;
  kind: EntityCardsPanelKind;
  onKindChange: (kind: EntityCardsPanelKind) => void;
  contacts: KindDataset<ContactEntityCard>;
  organizations: KindDataset<OrgEntityCard>;
  filterLabel?: string;
  sourceLabelPrefix?: string;
  loading?: boolean;
  countDetailWhenAll?: string;
  countDetailWhenOne?: string;
};

type ListedContactCard = ContactEntityCard & {
  optionId: string;
  optionLabel: string;
};

type ListedOrgCard = OrgEntityCard & {
  optionId: string;
  optionLabel: string;
};

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">
        {value?.trim() ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function ContactCardView({
  card,
  showSource,
  sourceLabelPrefix,
}: {
  card: ListedContactCard;
  showSource: boolean;
  sourceLabelPrefix: string;
}) {
  return (
    <article className="border-b border-slate-200 py-4 last:border-b-0">
      <h3 className="text-sm font-semibold text-slate-900">
        {contactCardDisplayName(card)}
      </h3>
      {showSource ? (
        <p className="mt-0.5 text-xs text-slate-500">
          {sourceLabelPrefix} {card.optionLabel}
        </p>
      ) : null}
      <dl className="mt-3 space-y-1.5">
        <FieldRow label="First name" value={card.first_name} />
        <FieldRow label="Last name" value={card.last_name} />
        <FieldRow label="Email" value={card.email} />
        <FieldRow label="Phone" value={card.phone} />
        <FieldRow label="Job title" value={card.job_title} />
      </dl>
    </article>
  );
}

function OrgCardView({
  card,
  showSource,
  sourceLabelPrefix,
}: {
  card: ListedOrgCard;
  showSource: boolean;
  sourceLabelPrefix: string;
}) {
  return (
    <article className="border-b border-slate-200 py-4 last:border-b-0">
      <h3 className="text-sm font-semibold text-slate-900">
        {orgCardDisplayName(card)}
      </h3>
      {showSource ? (
        <p className="mt-0.5 text-xs text-slate-500">
          {sourceLabelPrefix} {card.optionLabel}
        </p>
      ) : null}
      <dl className="mt-3 space-y-1.5">
        <FieldRow label="Name" value={card.name} />
        <FieldRow label="Role" value={card.organization_role} />
        <FieldRow label="Email" value={card.email} />
        <FieldRow label="Phone" value={card.phone} />
        <FieldRow label="Website" value={card.website} />
      </dl>
    </article>
  );
}

function listCards<TCard>(
  dataset: KindDataset<TCard>,
): {
  listed: Array<TCard & { optionId: string; optionLabel: string }>;
  showingPreferredAll: boolean;
  showSource: boolean;
} {
  const labelById = new Map(
    dataset.filterOptions.map((option) => [option.id, option.label]),
  );
  const preferredAllCards = dataset.preferredAllCards ?? null;
  const showingPreferredAll =
    dataset.selectedOptionId == null && preferredAllCards != null;

  const listed: Array<TCard & { optionId: string; optionLabel: string }> = [];
  if (showingPreferredAll) {
    for (const card of preferredAllCards ?? []) {
      listed.push({
        ...card,
        optionId: "__all__",
        optionLabel: "Merged",
      });
    }
  } else {
    const optionIds =
      dataset.selectedOptionId != null
        ? [dataset.selectedOptionId]
        : dataset.filterOptions.map((option) => option.id);

    for (const optionId of optionIds) {
      const cards = dataset.cardsByOptionId[optionId] ?? [];
      const optionLabel = labelById.get(optionId) ?? optionId.slice(0, 8);
      for (const card of cards) {
        listed.push({ ...card, optionId, optionLabel });
      }
    }
  }

  const showSource =
    !showingPreferredAll &&
    dataset.selectedOptionId == null &&
    dataset.filterOptions.length > 1;

  return { listed, showingPreferredAll, showSource };
}

function countCardsInDataset<TCard>(dataset: KindDataset<TCard>): number {
  if (dataset.preferredAllCards != null) {
    return dataset.preferredAllCards.length;
  }
  let total = 0;
  for (const cards of Object.values(dataset.cardsByOptionId)) {
    total += cards.length;
  }
  return total;
}

/** Generic entity-cards drawer (email or thread filter) with Contacts / Organizations tabs. */
export function EntityCardsFilterPanel({
  open,
  onClose,
  kind,
  onKindChange,
  contacts,
  organizations,
  filterLabel = "Email filter",
  sourceLabelPrefix = "From email:",
  loading = false,
  countDetailWhenAll = " across all",
  countDetailWhenOne = " for this selection",
}: BaseProps) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const dataset = kind === "organizations" ? organizations : contacts;
  const { listed, showingPreferredAll, showSource } =
    kind === "organizations"
      ? listCards(organizations)
      : listCards(contacts);
  const contactCount = countCardsInDataset(contacts);
  const orgCount = countCardsInDataset(organizations);
  const eyebrow =
    kind === "organizations"
      ? "Organization fingerprints"
      : "Contact fingerprints";
  const emptyMessage =
    dataset.emptyMessage ??
    (kind === "organizations"
      ? "No organization entity cards yet. Run the 3rd pass (fingerprints), then the 4th pass (merge)."
      : "No entity cards yet. Run the 3rd pass (fingerprints), then the 4th pass (merge) to populate unique contacts.");
  const allOptionLabel =
    dataset.allOptionLabel ??
    (kind === "organizations" ? "All emails" : "All emails");

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close entity cards panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-cards-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {eyebrow}
            </p>
            <h2
              id="entity-cards-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              Entity cards
            </h2>
            {dataset.modelLabel ? (
              <p className="mt-1 text-sm text-slate-600">{dataset.modelLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Entity card kind"
          className="flex shrink-0 border-b border-slate-200 px-5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={kind === "contacts"}
            id="entity-cards-tab-contacts"
            onClick={() => onKindChange("contacts")}
            className={[
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              kind === "contacts"
                ? "border-violet-600 text-violet-900"
                : "border-transparent text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            Contacts
            {contactCount > 0 ? (
              <span className="ml-1.5 tabular-nums text-slate-400">
                {contactCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "organizations"}
            id="entity-cards-tab-organizations"
            onClick={() => onKindChange("organizations")}
            className={[
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              kind === "organizations"
                ? "border-fuchsia-600 text-fuchsia-900"
                : "border-transparent text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            Organizations
            {orgCount > 0 ? (
              <span className="ml-1.5 tabular-nums text-slate-400">
                {orgCount}
              </span>
            ) : null}
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-200 px-5 py-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            {filterLabel}
            <select
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              value={dataset.selectedOptionId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                dataset.onSelectedOptionIdChange(value ? value : null);
              }}
            >
              <option value="">{allOptionLabel}</option>
              {dataset.filterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            {loading
              ? "Loading…"
              : `${listed.length} card${listed.length === 1 ? "" : "s"}${
                  showingPreferredAll
                    ? " · unique after merge"
                    : dataset.selectedOptionId == null
                      ? countDetailWhenAll
                      : countDetailWhenOne
                }`}
          </p>
          {dataset.selectedOptionId == null && dataset.allUnmergedHint ? (
            <p className="mt-1 text-xs text-amber-700">
              {dataset.allUnmergedHint}
            </p>
          ) : null}
        </div>

        <div
          role="tabpanel"
          aria-labelledby={
            kind === "organizations"
              ? "entity-cards-tab-organizations"
              : "entity-cards-tab-contacts"
          }
          className="min-h-0 flex-1 overflow-y-auto px-5"
        >
          {loading ? (
            <p className="py-8 text-sm text-slate-500">Loading entity cards…</p>
          ) : listed.length === 0 ? (
            <p className="py-8 text-sm text-slate-500">{emptyMessage}</p>
          ) : kind === "organizations" ? (
            (listed as ListedOrgCard[]).map((card, index) => (
              <OrgCardView
                key={`${card.optionId}-${index}-${orgCardDisplayName(card)}`}
                card={card}
                showSource={showSource}
                sourceLabelPrefix={sourceLabelPrefix}
              />
            ))
          ) : (
            (listed as ListedContactCard[]).map((card, index) => (
              <ContactCardView
                key={`${card.optionId}-${index}-${contactCardDisplayName(card)}`}
                card={card}
                showSource={showSource}
                sourceLabelPrefix={sourceLabelPrefix}
              />
            ))
          )}
        </div>
      </aside>
    </>
  );
}

type ThreadPageProps = {
  open: boolean;
  onClose: () => void;
  kind: EntityCardsPanelKind;
  onKindChange: (kind: EntityCardsPanelKind) => void;
  /** Per-email contact fingerprint cards (pass 3). */
  contactEntityCardsByEmailId: Record<string, ContactEntityCard[]>;
  /** Merged unique contact cards (pass 4). */
  contactMergedEntityCards: ContactEntityCard[] | null;
  contactModelLabel: string | null;
  /** Per-email org fingerprint cards (pass 3). */
  orgEntityCardsByEmailId: Record<string, OrgEntityCard[]>;
  /** Merged unique org cards (pass 4). */
  orgMergedEntityCards: OrgEntityCard[] | null;
  orgModelLabel: string | null;
  emailOptions: EntityCardEmailOption[];
  /** null = All emails (merged when available) */
  selectedEmailId: string | null;
  onSelectedEmailIdChange: (emailId: string | null) => void;
};

/** Thread-page entity cards panel (email filter + merge-all + kind tabs). */
export function EntityCardsSidePanel({
  open,
  onClose,
  kind,
  onKindChange,
  contactEntityCardsByEmailId,
  contactMergedEntityCards,
  contactModelLabel,
  orgEntityCardsByEmailId,
  orgMergedEntityCards,
  orgModelLabel,
  emailOptions,
  selectedEmailId,
  onSelectedEmailIdChange,
}: ThreadPageProps) {
  const filterOptions = emailOptions.map((option) => ({
    id: option.emailId,
    label: option.label,
  }));

  return (
    <EntityCardsFilterPanel
      open={open}
      onClose={onClose}
      kind={kind}
      onKindChange={onKindChange}
      contacts={{
        cardsByOptionId: contactEntityCardsByEmailId,
        preferredAllCards: contactMergedEntityCards,
        filterOptions,
        selectedOptionId: selectedEmailId,
        onSelectedOptionIdChange: onSelectedEmailIdChange,
        modelLabel: contactModelLabel,
        allOptionLabel: contactMergedEntityCards
          ? "All emails (merged)"
          : "All emails",
        allUnmergedHint: !contactMergedEntityCards
          ? "Run the 4th pass (merge) to combine duplicate people across emails."
          : null,
        emptyMessage:
          "No contact entity cards yet. Run the 3rd pass (fingerprints), then the 4th pass (merge).",
      }}
      organizations={{
        cardsByOptionId: orgEntityCardsByEmailId,
        preferredAllCards: orgMergedEntityCards,
        filterOptions,
        selectedOptionId: selectedEmailId,
        onSelectedOptionIdChange: onSelectedEmailIdChange,
        modelLabel: orgModelLabel,
        allOptionLabel: orgMergedEntityCards
          ? "All emails (merged)"
          : "All emails",
        allUnmergedHint: !orgMergedEntityCards
          ? "Run the 4th pass (merge) to combine duplicate organizations across emails."
          : null,
        emptyMessage:
          "No organization entity cards yet. Run organization extraction (3rd/4th passes) from the inbox, or add org extraction on this thread.",
      }}
      filterLabel="Email filter"
      sourceLabelPrefix="From email:"
      countDetailWhenAll=" across all emails (unmerged)"
      countDetailWhenOne=" for this email"
    />
  );
}
