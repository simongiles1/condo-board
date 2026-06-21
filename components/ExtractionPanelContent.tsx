"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { InsightsSubTabStrip } from "@/components/InsightsSubTabStrip";
import { NamedEntitiesList, ThreadEntityReviewList } from "@/components/NamedEntitiesList";
import { SourceQuoteDisplay } from "@/components/SourceQuoteDisplay";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";
import type {
  ExtractionAuditDestinationGroup,
  ExtractionAuditItem,
} from "@/lib/email/extraction-audit";
import {
  groupBidAlternativesUnderSystems,
  isMaintenanceBidAlternativeItem,
  isMaintenanceInstalledSystemItem,
  isMaintenanceMinorItem,
  prepareMaintenanceAuditItems,
  resolveEquipmentAuditMeta,
} from "@/lib/email/extraction-audit-display";

const METADATA_DESTINATION_ID = "metadata";

export function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function ProcessorInitials({
  email,
  size = "sm",
}: {
  email: string;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "md" ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs";

  return (
    <span
      title={email}
      aria-label={`Analyzed by ${email}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-violet-600 bg-violet-600 font-semibold text-white shadow-sm ${sizeClass}`}
    >
      {emailInitials(email)}
    </span>
  );
}

export function ProcessorInitialsGroup({ emails }: { emails: string[] }) {
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  if (uniqueEmails.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center -space-x-1.5">
      {uniqueEmails.map((email) => (
        <ProcessorInitials key={email} email={email} />
      ))}
    </span>
  );
}

export function mergeDestinationGroups(
  groups: ExtractionAuditDestinationGroup[],
): ExtractionAuditDestinationGroup[] {
  const merged = new Map<string, ExtractionAuditDestinationGroup>();

  for (const group of groups) {
    const existing = merged.get(group.destination.id);
    if (existing) {
      existing.items.push(...group.items);
    } else {
      merged.set(group.destination.id, {
        destination: group.destination,
        items: [...group.items],
      });
    }
  }

  return Array.from(merged.values());
}

export function mergeThreadTags(tags: string[][]): string[] {
  return [...new Set(tags.flat().filter(Boolean))];
}

function countFacts(groups: ExtractionAuditDestinationGroup[]): number {
  return groups
    .filter((group) => group.destination.id !== METADATA_DESTINATION_ID)
    .reduce((sum, group) => sum + group.items.length, 0);
}

function getDestinationGroupCount(
  group: ExtractionAuditDestinationGroup,
  threadEntityGroups?: ThreadEntityReviewGroup[],
): number {
  if (group.destination.id === "entities" && threadEntityGroups?.length) {
    return threadEntityGroups.length;
  }
  return group.items.length;
}

type GroupStatusKind = "saved" | "partial" | "archive";

function getGroupStatus(group: ExtractionAuditDestinationGroup): GroupStatusKind {
  const persistedCount = group.items.filter((item) => item.persisted).length;
  if (persistedCount === 0) return "archive";
  if (persistedCount === group.items.length) return "saved";
  return "partial";
}

function GroupStatusTag({
  group,
  threadEntityGroups,
}: {
  group: ExtractionAuditDestinationGroup;
  threadEntityGroups?: ThreadEntityReviewGroup[];
}) {
  const { destination } = group;

  if (destination.id === "entities") {
    if (threadEntityGroups?.length) {
      const pendingCount = threadEntityGroups.filter(
        (entry) => entry.reviewStatus === "pending",
      ).length;
      const approvedCount = threadEntityGroups.length - pendingCount;

      if (pendingCount > 0 && approvedCount > 0) {
        return (
          <span className="text-xs font-medium text-amber-700">
            ◑ {approvedCount} approved, {pendingCount} pending → entity_mentions
          </span>
        );
      }
      if (pendingCount > 0) {
        return (
          <span className="text-xs font-medium text-amber-700">
            ◑ Pending review → entity_mentions
          </span>
        );
      }
      return (
        <span className="text-xs font-medium text-emerald-700">
          ✓ Approved → entity_mentions
        </span>
      );
    }

    return (
      <span className="text-xs font-medium text-amber-700">
        ◑ Pending review → entity_mentions
      </span>
    );
  }

  const status = getGroupStatus(group);
  const targets = destination.dbTables;

  if (status === "archive") {
    return (
      <span className="text-xs text-slate-400">Archive only · not saved to a table</span>
    );
  }

  if (destination.id === "vendors") {
    return (
      <span className="text-xs font-medium text-amber-700">
        ◑ Pending review → vendors
      </span>
    );
  }

  const label = status === "partial" ? "Partly saved" : "Saved";
  const colorClass = status === "partial" ? "text-amber-700" : "text-emerald-700";

  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {status === "partial" ? "◑ " : "✓ "}
      {label}
      {targets.length > 0 ? (
        <span className="font-normal text-slate-500"> → {targets.join(", ")}</span>
      ) : null}
    </span>
  );
}

type MaintenanceTab = "systems" | "bids" | "minor" | "events";

function EquipmentAuditRow({
  item,
  nested = false,
}: {
  item: ExtractionAuditItem;
  nested?: boolean;
}) {
  const meta = resolveEquipmentAuditMeta(item);

  return (
    <div className={`leading-snug ${nested ? "ml-4 border-l border-slate-200 pl-3" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-sm text-slate-900 ${nested ? "" : "font-medium"}`}>{item.summary}</p>
        {meta?.kind === "component" ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Component
          </span>
        ) : null}
        {meta?.manufacturer ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-teal-100">
            {meta.manufacturer}
          </span>
        ) : null}
        {meta?.category ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {meta.category}
          </span>
        ) : null}
      </div>
      {item.sourceQuote ? <SourceQuoteDisplay quote={item.sourceQuote} /> : null}
    </div>
  );
}

function SystemEquipmentGroup({
  system,
  bids,
}: {
  system: ExtractionAuditItem;
  bids: ExtractionAuditItem[];
}) {
  return (
    <li className="space-y-2 leading-snug">
      <EquipmentAuditRow item={system} />
      {bids.length > 0 ? (
        <ul className="space-y-2">
          <li className="ml-4 text-xs font-medium uppercase tracking-wide text-slate-400">
            Bid options ({bids.length})
          </li>
          {bids.map((bid, index) => (
            <li key={`${bid.summary}-${index}`}>
              <EquipmentAuditRow item={bid} nested />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MaintenanceAuditList({ items }: { items: ExtractionAuditItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) =>
        item.fieldKey === "equipment_mentions" ? (
          <li key={`${item.fieldKey}-${index}`}>
            <EquipmentAuditRow item={item} />
          </li>
        ) : (
          <li key={`${item.fieldKey}-${index}`} className="leading-snug">
            <p className="text-sm text-slate-900">{item.summary}</p>
            {item.sourceQuote ? <SourceQuoteDisplay quote={item.sourceQuote} /> : null}
          </li>
        ),
      )}
    </ul>
  );
}

function MaintenanceEquipmentSection({ items }: { items: ExtractionAuditItem[] }) {
  const preparedItems = useMemo(() => prepareMaintenanceAuditItems(items), [items]);

  const systemItems = useMemo(
    () => preparedItems.filter((item) => isMaintenanceInstalledSystemItem(item)),
    [preparedItems],
  );

  const bidItems = useMemo(
    () => preparedItems.filter((item) => isMaintenanceBidAlternativeItem(item)),
    [preparedItems],
  );

  const minorItems = useMemo(
    () => preparedItems.filter((item) => isMaintenanceMinorItem(item)),
    [preparedItems],
  );

  const eventItems = useMemo(
    () => preparedItems.filter((item) => item.fieldKey === "maintenance_events"),
    [preparedItems],
  );

  const groupedSystems = useMemo(
    () => groupBidAlternativesUnderSystems(systemItems, bidItems),
    [systemItems, bidItems],
  );

  const tabs = useMemo(() => {
    const entries: Array<{ id: MaintenanceTab; label: string; count: number }> = [];
    if (systemItems.length > 0) {
      entries.push({ id: "systems", label: "Systems", count: systemItems.length });
    }
    if (bidItems.length > 0 && systemItems.length === 0) {
      entries.push({
        id: "bids",
        label: "Bid alternatives",
        count: bidItems.length,
      });
    }
    if (minorItems.length > 0) {
      entries.push({
        id: "minor",
        label: "Minor & components",
        count: minorItems.length,
      });
    }
    if (eventItems.length > 0) {
      entries.push({
        id: "events",
        label: "Maintenance events",
        count: eventItems.length,
      });
    }
    return entries;
  }, [systemItems.length, bidItems.length, minorItems.length, eventItems.length]);

  const [activeTab, setActiveTab] = useState<MaintenanceTab>("systems");

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  if (tabs.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No equipment or maintenance events.</p>;
  }

  return (
    <div className="mt-2">
      {tabs.length > 1 ? (
        <div
          className="mb-3 flex flex-wrap gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="Maintenance and equipment categories"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`border-b-2 px-2.5 py-1.5 text-xs font-medium transition ${
                activeTab === tab.id
                  ? "border-teal-700 text-teal-800"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className="ml-1 text-slate-400">({tab.count})</span>
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === "systems" ? (
        groupedSystems.length > 0 ? (
          <ul className="space-y-4">
            {groupedSystems.map((group, index) => (
              <SystemEquipmentGroup
                key={`${group.system.summary}-${index}`}
                system={group.system}
                bids={group.bids}
              />
            ))}
          </ul>
        ) : (
          <MaintenanceAuditList items={systemItems} />
        )
      ) : null}

      {activeTab === "bids" ? <MaintenanceAuditList items={bidItems} /> : null}
      {activeTab === "minor" ? <MaintenanceAuditList items={minorItems} /> : null}
      {activeTab === "events" ? <MaintenanceAuditList items={eventItems} /> : null}
    </div>
  );
}

function ExtractionItemList({ items }: { items: ExtractionAuditItem[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {items.map((item, index) => (
        <li key={`${item.fieldKey}-${index}`} className="leading-snug">
          <p className="text-sm text-slate-900">{item.summary}</p>
          {item.sourceQuote ? <SourceQuoteDisplay quote={item.sourceQuote} /> : null}
        </li>
      ))}
    </ul>
  );
}

const METADATA_TAB_ID = "metadata";

function DestinationGroupBody({
  group,
  threadEntityGroups,
  highlightEmailId,
  showTitle,
}: {
  group: ExtractionAuditDestinationGroup;
  threadEntityGroups?: ThreadEntityReviewGroup[];
  highlightEmailId?: string | null;
  showTitle?: boolean;
}) {
  const { destination, items } = group;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {showTitle ? (
          <h4 className="font-semibold text-slate-900">{destination.title}</h4>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <GroupStatusTag
            group={group}
            threadEntityGroups={
              destination.id === "entities" ? threadEntityGroups : undefined
            }
          />
          {destination.appPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="text-xs text-teal-700 hover:underline"
            >
              {page.label}
            </Link>
          ))}
        </div>
      </div>

      {destination.id === "entities" ? (
        <div className="mt-2">
          {threadEntityGroups?.length ? (
            <ThreadEntityReviewList groups={threadEntityGroups} />
          ) : (
            <NamedEntitiesList items={items} highlightEmailId={highlightEmailId} />
          )}
        </div>
      ) : destination.id === "maintenance" ? (
        <MaintenanceEquipmentSection items={items} />
      ) : (
        <ExtractionItemList items={items} />
      )}
    </div>
  );
}

function MetadataSectionBody({
  metadataItems,
  tags,
  showTitle,
}: {
  metadataItems: ExtractionAuditItem[];
  tags: string[];
  showTitle?: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {showTitle ? (
          <h4 className="text-sm font-medium text-slate-600">Summary metadata</h4>
        ) : null}
        <span className="text-xs text-slate-400">
          Archive only · shown as inbox badges
        </span>
      </div>
      {metadataItems.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          {metadataItems.map((item, index) => (
            <li key={`${item.fieldKey}-${index}`} className="leading-snug">
              <span className="text-slate-400">{item.fieldLabel}:</span>{" "}
              {item.summary}
            </li>
          ))}
        </ul>
      ) : null}
      {tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExtractionDetailsBody({
  destinationGroups,
  threadEntityGroups,
  tags,
  footer,
  highlightEmailId,
  className = "space-y-4",
}: {
  destinationGroups: ExtractionAuditDestinationGroup[];
  threadEntityGroups?: ThreadEntityReviewGroup[];
  tags: string[];
  footer?: ReactNode;
  highlightEmailId?: string | null;
  className?: string;
}) {
  const factGroups = destinationGroups.filter(
    (group) => group.destination.id !== METADATA_DESTINATION_ID,
  );
  const metadataGroup = destinationGroups.find(
    (group) => group.destination.id === METADATA_DESTINATION_ID,
  );
  const metadataItems = (metadataGroup?.items ?? []).filter(
    (item) => item.fieldKey !== "tags",
  );
  const factsCount = countFacts(destinationGroups);
  const hasMetadata = metadataItems.length > 0 || tags.length > 0;

  const sectionTabs = useMemo(() => {
    const entries: Array<{ id: string; label: string }> = [];

    for (const group of factGroups) {
      entries.push({
        id: group.destination.id,
        label: group.destination.title,
      });
    }

    if (hasMetadata) {
      entries.push({
        id: METADATA_TAB_ID,
        label: "Summary metadata",
      });
    }

    return entries;
  }, [factGroups, hasMetadata]);

  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const group of factGroups) {
      counts[group.destination.id] = getDestinationGroupCount(
        group,
        threadEntityGroups,
      );
    }

    if (hasMetadata) {
      counts[METADATA_TAB_ID] = metadataItems.length + tags.length;
    }

    return counts;
  }, [factGroups, threadEntityGroups, hasMetadata, metadataItems.length, tags.length]);

  const [activeSectionTab, setActiveSectionTab] = useState("");

  useEffect(() => {
    if (sectionTabs.length === 0) return;
    if (!sectionTabs.some((tab) => tab.id === activeSectionTab)) {
      setActiveSectionTab(sectionTabs[0].id);
    }
  }, [sectionTabs, activeSectionTab]);

  const activeFactGroup = factGroups.find(
    (group) => group.destination.id === activeSectionTab,
  );
  const showSectionTitle = sectionTabs.length === 1;

  return (
    <div className={className}>
      {factsCount > 0 || footer ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-slate-600">
          {factsCount > 0 ? (
            <span>
              {factsCount} structured fact{factsCount === 1 ? "" : "s"} extracted
            </span>
          ) : (
            <span />
          )}
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}

      {sectionTabs.length > 0 ? (
        <div className="space-y-3">
          {sectionTabs.length > 1 ? (
            <InsightsSubTabStrip
              tabs={sectionTabs}
              active={activeSectionTab}
              onChange={setActiveSectionTab}
              counts={sectionCounts}
              ariaLabel="Extraction categories"
              wrap
            />
          ) : null}

          <section
            className={`rounded-lg border border-slate-200 p-3 ${
              activeSectionTab === METADATA_TAB_ID ? "bg-slate-50/70" : "bg-white"
            }`}
          >
            {activeFactGroup ? (
              <DestinationGroupBody
                group={activeFactGroup}
                threadEntityGroups={threadEntityGroups}
                highlightEmailId={highlightEmailId}
                showTitle={showSectionTitle}
              />
            ) : null}

            {activeSectionTab === METADATA_TAB_ID && hasMetadata ? (
              <MetadataSectionBody
                metadataItems={metadataItems}
                tags={tags}
                showTitle={showSectionTitle}
              />
            ) : null}
          </section>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No structured facts — only summary metadata was extracted.
        </p>
      )}
    </div>
  );
}
