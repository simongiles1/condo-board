"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EntityCardsFilterPanel,
  type EntityCardsPanelKind,
} from "@/components/EntityCardsSidePanel";
import {
  CONTACT_HIGHLIGHT_MODELS,
  getContactHighlightModelMeta,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import type { ContactExtractSummary } from "@/lib/email-analysis/contact-highlight-run-display";
import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";
import {
  ORG_HIGHLIGHT_MODELS,
  getOrgHighlightModelMeta,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import type { OrgExtractSummary } from "@/lib/email-analysis/org-highlight-run-display";
import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";

export type InboxEntityCardThread = {
  id: string;
  label: string;
  /** When empty, email ids are resolved via prepare?threadId= on load. */
  emailIds: string[];
};

function threadHasFingerprintSummary(
  summary: ContactExtractSummary | OrgExtractSummary | null | undefined,
): boolean {
  if (!summary) return false;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    if ((run.fourthPass?.stats.cardCount ?? 0) > 0) return true;
    if ((run.thirdPass?.stats.cardCount ?? 0) > 0) return true;
    if (run.thirdPass != null || run.fourthPass != null) return true;
  }
  return false;
}

type ContactFingerprintRun = {
  thirdPass?: {
    entityCardsByEmailId?: Record<string, ContactEntityCard[]>;
  } | null;
  fourthPass?: {
    entityCards?: ContactEntityCard[];
  } | null;
};

type OrgFingerprintRun = {
  thirdPass?: {
    entityCardsByEmailId?: Record<string, OrgEntityCard[]>;
  } | null;
  fourthPass?: {
    entityCards?: OrgEntityCard[];
  } | null;
};

type KindCardsState<TCard, TModelId extends string> = {
  cardsByThreadId: Record<string, TCard[]>;
  modelLabel: string | null;
  cardCount: number;
  threadsMissingMerge: number;
  modelId: TModelId | null;
};

function flattenPass3Cards<TCard>(
  byEmailId: Record<string, TCard[]> | undefined,
): TCard[] {
  if (!byEmailId) return [];
  const out: TCard[] = [];
  for (const cards of Object.values(byEmailId)) {
    for (const card of cards) out.push(card);
  }
  return out;
}

function pickFingerprintRun<TModelId extends string, TRun>(
  models: readonly TModelId[],
  runs: Partial<Record<TModelId, TRun>>,
  getMerged: (run: TRun) => unknown[] | undefined,
  getPass3: (run: TRun) => Record<string, unknown[]> | undefined,
): { modelId: TModelId; run: TRun } | null {
  for (const modelId of models) {
    const run = runs[modelId];
    if (!run) continue;
    const merged = getMerged(run);
    if (merged && merged.length > 0) {
      return { modelId, run };
    }
  }
  for (const modelId of models) {
    const run = runs[modelId];
    if (!run) continue;
    const byEmail = getPass3(run);
    if (byEmail && Object.values(byEmail).some((cards) => cards.length > 0)) {
      return { modelId, run };
    }
  }
  for (const modelId of models) {
    const run = runs[modelId];
    if (run) return { modelId, run };
  }
  return null;
}

function cardsFromContactRun(run: ContactFingerprintRun): {
  cards: ContactEntityCard[];
  usedMerge: boolean;
} {
  const merged = run.fourthPass?.entityCards;
  if (merged && merged.length > 0) {
    return { cards: merged, usedMerge: true };
  }
  return {
    cards: flattenPass3Cards(run.thirdPass?.entityCardsByEmailId),
    usedMerge: false,
  };
}

function cardsFromOrgRun(run: OrgFingerprintRun): {
  cards: OrgEntityCard[];
  usedMerge: boolean;
} {
  const merged = run.fourthPass?.entityCards;
  if (merged && merged.length > 0) {
    return { cards: merged, usedMerge: true };
  }
  return {
    cards: flattenPass3Cards(run.thirdPass?.entityCardsByEmailId),
    usedMerge: false,
  };
}

async function resolveEmailIds(
  thread: InboxEntityCardThread,
): Promise<string[]> {
  if (thread.emailIds.length > 0) return thread.emailIds;

  const response = await fetch(
    `/api/analysis/extract-contacts/prepare?threadId=${encodeURIComponent(thread.id)}`,
  );
  const data = (await response.json()) as {
    items?: Array<{ emailId?: string }>;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Could not load thread emails.");
  }
  return (data.items ?? [])
    .map((item) => (typeof item.emailId === "string" ? item.emailId.trim() : ""))
    .filter(Boolean);
}

async function loadContactThreadCards(
  thread: InboxEntityCardThread,
): Promise<{
  cards: ContactEntityCard[];
  modelId: ContactHighlightModelId | null;
  usedMerge: boolean;
}> {
  const emailIds = await resolveEmailIds(thread);
  if (emailIds.length === 0) {
    return { cards: [], modelId: null, usedMerge: false };
  }

  const response = await fetch(
    `/api/analysis/extract-contacts?emailIds=${encodeURIComponent(emailIds.join(","))}`,
  );
  const data = (await response.json()) as {
    runs?: Partial<Record<ContactHighlightModelId, ContactFingerprintRun>>;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Could not load contact entity cards.");
  }

  const picked = pickFingerprintRun(
    CONTACT_HIGHLIGHT_MODELS,
    data.runs ?? {},
    (run) => run.fourthPass?.entityCards,
    (run) => run.thirdPass?.entityCardsByEmailId,
  );
  if (!picked) {
    return { cards: [], modelId: null, usedMerge: false };
  }
  const { cards, usedMerge } = cardsFromContactRun(picked.run);
  return { cards, modelId: picked.modelId, usedMerge };
}

async function loadOrgThreadCards(
  thread: InboxEntityCardThread,
): Promise<{
  cards: OrgEntityCard[];
  modelId: OrgHighlightModelId | null;
  usedMerge: boolean;
}> {
  const emailIds = await resolveEmailIds(thread);
  if (emailIds.length === 0) {
    return { cards: [], modelId: null, usedMerge: false };
  }

  const response = await fetch(
    `/api/analysis/extract-organizations?emailIds=${encodeURIComponent(emailIds.join(","))}`,
  );
  const data = (await response.json()) as {
    runs?: Partial<Record<OrgHighlightModelId, OrgFingerprintRun>>;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Could not load organization entity cards.");
  }

  const picked = pickFingerprintRun(
    ORG_HIGHLIGHT_MODELS,
    data.runs ?? {},
    (run) => run.fourthPass?.entityCards,
    (run) => run.thirdPass?.entityCardsByEmailId,
  );
  if (!picked) {
    return { cards: [], modelId: null, usedMerge: false };
  }
  const { cards, usedMerge } = cardsFromOrgRun(picked.run);
  return { cards, modelId: picked.modelId, usedMerge };
}

const EMPTY_CONTACT_STATE: KindCardsState<
  ContactEntityCard,
  ContactHighlightModelId
> = {
  cardsByThreadId: {},
  modelLabel: null,
  cardCount: 0,
  threadsMissingMerge: 0,
  modelId: null,
};

const EMPTY_ORG_STATE: KindCardsState<OrgEntityCard, OrgHighlightModelId> = {
  cardsByThreadId: {},
  modelLabel: null,
  cardCount: 0,
  threadsMissingMerge: 0,
  modelId: null,
};

type Props = {
  threads: InboxEntityCardThread[];
  /** When provided, only threads with pass-3/4 contact summaries are loaded for contacts. */
  contactExtractSummaries?: Record<string, ContactExtractSummary>;
  /** When provided, only threads with pass-3/4 org summaries are loaded for organizations. */
  orgExtractSummaries?: Record<string, OrgExtractSummary>;
};

export function InboxEntityCardsButton({
  threads,
  contactExtractSummaries = {},
  orgExtractSummaries = {},
}: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EntityCardsPanelKind>("contacts");
  const [selectedContactThreadId, setSelectedContactThreadId] = useState<
    string | null
  >(null);
  const [selectedOrgThreadId, setSelectedOrgThreadId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contactState, setContactState] = useState(EMPTY_CONTACT_STATE);
  const [orgState, setOrgState] = useState(EMPTY_ORG_STATE);

  const contactSummaryKeysMatch = useMemo(
    () => threads.some((thread) => thread.id in contactExtractSummaries),
    [threads, contactExtractSummaries],
  );
  const orgSummaryKeysMatch = useMemo(
    () => threads.some((thread) => thread.id in orgExtractSummaries),
    [threads, orgExtractSummaries],
  );

  const contactCandidateThreads = useMemo(() => {
    if (!contactSummaryKeysMatch) return threads;
    return threads.filter((thread) =>
      threadHasFingerprintSummary(contactExtractSummaries[thread.id]),
    );
  }, [threads, contactExtractSummaries, contactSummaryKeysMatch]);

  const orgCandidateThreads = useMemo(() => {
    if (!orgSummaryKeysMatch) return threads;
    return threads.filter((thread) =>
      threadHasFingerprintSummary(orgExtractSummaries[thread.id]),
    );
  }, [threads, orgExtractSummaries, orgSummaryKeysMatch]);

  const contactFilterOptions = useMemo(() => {
    const labelById = new Map(
      contactCandidateThreads.map((thread) => [
        thread.id,
        thread.label.trim() || "(No subject)",
      ]),
    );
    return Object.entries(contactState.cardsByThreadId)
      .filter(([, cards]) => cards.length > 0)
      .map(([id]) => ({
        id,
        label: labelById.get(id) ?? id.slice(0, 8),
      }));
  }, [contactCandidateThreads, contactState.cardsByThreadId]);

  const orgFilterOptions = useMemo(() => {
    const labelById = new Map(
      orgCandidateThreads.map((thread) => [
        thread.id,
        thread.label.trim() || "(No subject)",
      ]),
    );
    return Object.entries(orgState.cardsByThreadId)
      .filter(([, cards]) => cards.length > 0)
      .map(([id]) => ({
        id,
        label: labelById.get(id) ?? id.slice(0, 8),
      }));
  }, [orgCandidateThreads, orgState.cardsByThreadId]);

  const threadsKey = useMemo(
    () =>
      [
        ...contactCandidateThreads.map((t) => `c:${t.id}`),
        ...orgCandidateThreads.map((t) => `o:${t.id}`),
      ].join(","),
    [contactCandidateThreads, orgCandidateThreads],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [contactResults, orgResults] = await Promise.all([
        Promise.all(
          contactCandidateThreads.map(async (thread) => {
            const result = await loadContactThreadCards(thread);
            return { threadId: thread.id, ...result };
          }),
        ),
        Promise.all(
          orgCandidateThreads.map(async (thread) => {
            const result = await loadOrgThreadCards(thread);
            return { threadId: thread.id, ...result };
          }),
        ),
      ]);

      const contactCardsByThreadId: Record<string, ContactEntityCard[]> = {};
      let contactCardCount = 0;
      let contactMissingMerge = 0;
      let contactModelId: ContactHighlightModelId | null = null;

      for (const result of contactResults) {
        if (result.cards.length === 0) continue;
        contactCardsByThreadId[result.threadId] = result.cards;
        contactCardCount += result.cards.length;
        if (!result.usedMerge) contactMissingMerge += 1;
        if (!contactModelId && result.modelId) contactModelId = result.modelId;
      }

      const orgCardsByThreadId: Record<string, OrgEntityCard[]> = {};
      let orgCardCount = 0;
      let orgMissingMerge = 0;
      let orgModelId: OrgHighlightModelId | null = null;

      for (const result of orgResults) {
        if (result.cards.length === 0) continue;
        orgCardsByThreadId[result.threadId] = result.cards;
        orgCardCount += result.cards.length;
        if (!result.usedMerge) orgMissingMerge += 1;
        if (!orgModelId && result.modelId) orgModelId = result.modelId;
      }

      setContactState({
        cardsByThreadId: contactCardsByThreadId,
        modelLabel: contactModelId
          ? getContactHighlightModelMeta(contactModelId).label
          : null,
        cardCount: contactCardCount,
        threadsMissingMerge: contactMissingMerge,
        modelId: contactModelId,
      });
      setOrgState({
        cardsByThreadId: orgCardsByThreadId,
        modelLabel: orgModelId
          ? getOrgHighlightModelMeta(orgModelId).label
          : null,
        cardCount: orgCardCount,
        threadsMissingMerge: orgMissingMerge,
        modelId: orgModelId,
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load entity cards.",
      );
      setContactState(EMPTY_CONTACT_STATE);
      setOrgState(EMPTY_ORG_STATE);
    } finally {
      setLoading(false);
    }
  }, [contactCandidateThreads, orgCandidateThreads]);

  useEffect(() => {
    if (!open) return;
    void loadAll();
  }, [open, threadsKey, loadAll]);

  useEffect(() => {
    setSelectedContactThreadId(null);
    setSelectedOrgThreadId(null);
  }, [threadsKey]);

  useEffect(() => {
    if (
      selectedContactThreadId != null &&
      !(selectedContactThreadId in contactState.cardsByThreadId)
    ) {
      setSelectedContactThreadId(null);
    }
  }, [selectedContactThreadId, contactState.cardsByThreadId]);

  useEffect(() => {
    if (
      selectedOrgThreadId != null &&
      !(selectedOrgThreadId in orgState.cardsByThreadId)
    ) {
      setSelectedOrgThreadId(null);
    }
  }, [selectedOrgThreadId, orgState.cardsByThreadId]);

  if (threads.length === 0) return null;

  const totalCardCount = contactState.cardCount + orgState.cardCount;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Entity cards
        {totalCardCount > 0 ? ` (${totalCardCount})` : ""}
      </button>

      <EntityCardsFilterPanel
        open={open}
        onClose={() => setOpen(false)}
        kind={kind}
        onKindChange={setKind}
        contacts={{
          cardsByOptionId: contactState.cardsByThreadId,
          preferredAllCards: null,
          filterOptions: contactFilterOptions,
          selectedOptionId: selectedContactThreadId,
          onSelectedOptionIdChange: setSelectedContactThreadId,
          modelLabel: contactState.modelLabel,
          allOptionLabel: "All threads",
          allUnmergedHint:
            !loadError && contactState.threadsMissingMerge > 0
              ? `${contactState.threadsMissingMerge} thread${
                  contactState.threadsMissingMerge === 1 ? "" : "s"
                } show unmerged pass-3 cards. Run the 4th pass on those threads to dedupe within each thread. Cross-thread duplicates are merged on the Entities page (Contacts → AI decisions tab).`
              : !loadError && contactState.cardCount > 0
                ? "This panel lists per-thread fingerprints. Cross-thread duplicates are expected here — open Contacts to see the AI-merged global registry."
                : null,
          emptyMessage: loadError
            ? loadError
            : "No contact entity cards on this page yet. Select threads and run Extract Contacts (3rd/4th passes).",
        }}
        organizations={{
          cardsByOptionId: orgState.cardsByThreadId,
          preferredAllCards: null,
          filterOptions: orgFilterOptions,
          selectedOptionId: selectedOrgThreadId,
          onSelectedOptionIdChange: setSelectedOrgThreadId,
          modelLabel: orgState.modelLabel,
          allOptionLabel: "All threads",
          allUnmergedHint:
            !loadError && orgState.threadsMissingMerge > 0
              ? `${orgState.threadsMissingMerge} thread${
                  orgState.threadsMissingMerge === 1 ? "" : "s"
                } show unmerged pass-3 organization cards. Run the 4th pass on those threads to dedupe within each thread.`
              : !loadError && orgState.cardCount > 0
                ? "This panel lists per-thread organization fingerprints. An organizations registry is not wired yet."
                : null,
          emptyMessage: loadError
            ? loadError
            : "No organization entity cards on this page yet. Select threads and run Extract Organizations (3rd/4th passes).",
        }}
        filterLabel="Thread filter"
        sourceLabelPrefix="From thread:"
        loading={loading}
        countDetailWhenAll=" across extracted threads"
        countDetailWhenOne=" for this thread"
      />
    </>
  );
}
