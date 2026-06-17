"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { NamedEntitiesList, ThreadEntityReviewList } from "@/components/NamedEntitiesList";
import { SourceQuoteDisplay } from "@/components/SourceQuoteDisplay";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";
import type { ExtractionAuditDestinationGroup } from "@/lib/email/extraction-audit";

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

  return (
    <div className={className}>
      {factsCount > 0 ? (
        <p className="text-sm text-slate-600">
          {factsCount} structured fact{factsCount === 1 ? "" : "s"} extracted
        </p>
      ) : null}

      {footer ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">{footer}</div>
      ) : null}

      {factGroups.length > 0 ? (
        <div className="space-y-3">
          {factGroups.map((group) => {
            const { destination, items } = group;
            return (
              <section
                key={destination.id}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h4 className="font-semibold text-slate-900">{destination.title}</h4>
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
                      <NamedEntitiesList
                        items={items}
                        highlightEmailId={highlightEmailId}
                      />
                    )}
                  </div>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {items.map((item, index) => (
                      <li key={`${item.fieldKey}-${index}`} className="leading-snug">
                        <p className="text-sm text-slate-900">{item.summary}</p>
                        {item.sourceQuote ? (
                          <SourceQuoteDisplay quote={item.sourceQuote} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No structured facts — only summary metadata was extracted.
        </p>
      )}

      {metadataItems.length > 0 || tags.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="text-sm font-medium text-slate-600">Summary metadata</h4>
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
        </section>
      ) : null}
    </div>
  );
}
