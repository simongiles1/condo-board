"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  EXTRACTION_DESTINATIONS,
  PERSISTED_TABLE_LABELS,
} from "@/lib/email/extraction-routing";
import type {
  ExtractionAuditDestinationGroup,
  ExtractionAuditRecord,
} from "@/lib/email/extraction-audit";
import { formatDateTime } from "@/lib/format/datetime";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;
const POPOVER_Z_INDEX = 60;

type Props = {
  records: ExtractionAuditRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
};

function PersistBadge({ persisted }: { persisted: boolean }) {
  return persisted ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
      Saved to DB
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
      Extraction only
    </span>
  );
}

type AuditTabId = "routing" | "extractions";

const AUDIT_TABS: Array<{ id: AuditTabId; label: string }> = [
  { id: "routing", label: "Extraction routing" },
  { id: "extractions", label: "Extractions" },
];

function AuditTabStrip({
  active,
  onChange,
}: {
  active: AuditTabId;
  onChange: (tab: AuditTabId) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Extraction audit views"
    >
      {AUDIT_TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? -1 : 0}
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

function DestinationLegend() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-semibold text-slate-900">
        Where extracted data goes
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Each category below maps AI extraction fields to database tables and app
        pages. Items marked &ldquo;extraction only&rdquo; stay in the analysis
        archive but are not written to structured tables yet.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {EXTRACTION_DESTINATIONS.map((destination) => (
          <div
            key={destination.id}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <p className="font-medium text-slate-900">{destination.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {destination.description}
            </p>
            {destination.dbTables.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">Tables:</span>{" "}
                {destination.dbTables.join(", ")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">Tables:</span> none
              </p>
            )}
            {destination.appPages.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                <span className="font-medium text-slate-700">Shown in:</span>
                {destination.appPages.map((page) => (
                  <Link
                    key={page.href}
                    href={page.href}
                    className="text-teal-700 hover:underline"
                  >
                    {page.label}
                  </Link>
                ))}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SavedRowsSummary({
  savedRowCounts,
}: {
  savedRowCounts: Record<string, number>;
}) {
  const entries = Object.entries(savedRowCounts);
  if (!entries.length) {
    return (
      <p className="text-sm text-slate-500">
        No structured rows were saved from this extraction (deduped or
        extraction-only fields).
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([key, total]) => (
        <span
          key={key}
          className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-900 ring-1 ring-teal-200"
        >
          {PERSISTED_TABLE_LABELS[key] ?? key}: {total}
        </span>
      ))}
    </div>
  );
}

function computeBadgePopoverPosition(
  anchorRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceRight = viewportWidth - anchorRect.right - VIEWPORT_MARGIN;
  const spaceLeft = anchorRect.left - VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - anchorRect.bottom - VIEWPORT_MARGIN;
  const showRight = spaceRight >= popoverWidth || spaceRight >= spaceLeft;

  let top = anchorRect.top;
  let left: number;

  if (showRight) {
    left = anchorRect.right + VIEWPORT_MARGIN;
    if (left + popoverWidth > viewportWidth - VIEWPORT_MARGIN) {
      left = viewportWidth - VIEWPORT_MARGIN - popoverWidth;
    }
  } else {
    left = anchorRect.left - VIEWPORT_MARGIN - popoverWidth;
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }
  }

  if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
    top = Math.max(
      VIEWPORT_MARGIN,
      viewportHeight - VIEWPORT_MARGIN - popoverHeight,
    );
  }

  if (top < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN;
  }

  if (
    top + popoverHeight > viewportHeight - VIEWPORT_MARGIN &&
    spaceBelow >= popoverHeight
  ) {
    top = anchorRect.bottom + VIEWPORT_MARGIN;
  }

  return {
    position: "fixed",
    top,
    left,
    zIndex: POPOVER_Z_INDEX,
  };
}

function HoverDetailBadge({
  label,
  popoverTitle,
  children,
  disabled = false,
}: {
  label: string;
  popoverTitle: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const badgeRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: POPOVER_Z_INDEX,
  });

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (!badgeHoveredRef.current && !popoverHoveredRef.current) {
        setOpen(false);
      }
    }, POPOVER_HIDE_DELAY_MS);
  }

  function showPopover() {
    if (disabled) return;
    cancelHide();
    setOpen(true);
  }

  useEffect(() => {
    return () => cancelHide();
  }, []);

  useLayoutEffect(() => {
    if (!open || !badgeRef.current || !popoverRef.current) return;

    function updatePosition() {
      const anchorRect = badgeRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!anchorRect || !popover) return;

      setPopoverStyle({
        ...computeBadgePopoverPosition(
          anchorRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    updatePosition();
  }, [open, label, children]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const anchorRect = badgeRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!anchorRect || !popover) return;

      setPopoverStyle({
        ...computeBadgePopoverPosition(
          anchorRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, label, children]);

  return (
    <>
      <span
        ref={badgeRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 transition ${
          disabled
            ? "cursor-default"
            : "cursor-default hover:bg-slate-200/80"
        }`}
        onMouseEnter={() => {
          badgeHoveredRef.current = true;
          showPopover();
        }}
        onMouseLeave={() => {
          badgeHoveredRef.current = false;
          scheduleHide();
        }}
        onFocus={showPopover}
        onBlur={() => {
          badgeHoveredRef.current = false;
          scheduleHide();
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {label}
      </span>

      {open && !disabled && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[12rem] max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {popoverTitle}
              </p>
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ExtractedItemsPopoverContent({
  destinationGroups,
}: {
  destinationGroups: ExtractionAuditDestinationGroup[];
}) {
  const items = destinationGroups
    .filter((group) => group.destination.id !== "metadata")
    .flatMap((group) => group.items);

  if (!items.length) {
    return (
      <p className="text-xs text-slate-500">
        No structured facts — only email summary metadata was extracted.
      </p>
    );
  }

  return (
    <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-xs text-slate-600">
      {items.map((item, index) => (
        <li key={`${item.fieldKey}-${index}`} className="leading-snug">
          <span className="font-medium text-slate-500">{item.fieldLabel}:</span>{" "}
          {item.summary}
        </li>
      ))}
    </ul>
  );
}

function DestinationsPopoverContent({
  destinationGroups,
}: {
  destinationGroups: ExtractionAuditDestinationGroup[];
}) {
  return (
    <ul className="max-h-48 space-y-3 overflow-y-auto pr-1 text-xs text-slate-600">
      {destinationGroups.map(({ destination, items }) => (
        <li key={destination.id}>
          <p className="font-semibold text-slate-800">
            {destination.title}{" "}
            <span className="font-normal text-slate-500">
              ({items.length} item{items.length === 1 ? "" : "s"})
            </span>
          </p>
          {destination.dbTables.length > 0 ? (
            <p className="mt-0.5 text-slate-500">
              → {destination.dbTables.join(", ")}
            </p>
          ) : (
            <p className="mt-0.5 text-slate-500">→ extraction archive only</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {items.map((item, index) => (
              <li key={`${destination.id}-${index}`} className="leading-snug">
                {item.summary}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function AuditRecordCard({ record }: { record: ExtractionAuditRecord }) {
  const [open, setOpen] = useState(false);

  const title =
    record.emailSubject ??
    (record.sourceType === "meeting" ? "Meeting extraction" : "Email extraction");

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 py-4">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-4 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <div className="min-w-0 space-y-1">
            <h3 className="truncate font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600">
              {record.emailFrom ? (
                <>
                  <span>{record.emailFrom}</span>
                  <span className="mx-1 text-slate-400">·</span>
                </>
              ) : null}
              <time dateTime={record.processedAt}>
                Analyzed {formatDateTime(record.processedAt)}
              </time>
              {record.emailReceivedAt ? (
                <>
                  <span className="mx-1 text-slate-400">·</span>
                  <span>
                    Received {formatDateTime(record.emailReceivedAt)}
                  </span>
                </>
              ) : null}
            </p>
            {record.summary ? (
              <p className="line-clamp-2 text-sm leading-relaxed text-slate-700">
                {record.summary}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {record.documentType ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {record.documentType.replace(/_/g, " ")}
                </span>
              ) : null}
              {record.urgency ? (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200">
                  {record.urgency}
                </span>
              ) : null}
            </div>
          </div>
          <span className="shrink-0 text-sm text-slate-500">
            {open ? "Hide" : "Show"}
          </span>
        </button>

        <div className="mt-2 flex flex-wrap gap-2">
          <HoverDetailBadge
            label={`${record.totalExtractedItems} extracted item${
              record.totalExtractedItems === 1 ? "" : "s"
            }`}
            popoverTitle="Extracted items"
            disabled={record.totalExtractedItems === 0}
          >
            <ExtractedItemsPopoverContent
              destinationGroups={record.destinationGroups}
            />
          </HoverDetailBadge>
          <HoverDetailBadge
            label={`${record.destinationGroups.length} destination${
              record.destinationGroups.length === 1 ? "" : "s"
            }`}
            popoverTitle="Destinations"
            disabled={record.destinationGroups.length === 0}
          >
            <DestinationsPopoverContent
              destinationGroups={record.destinationGroups}
            />
          </HoverDetailBadge>
        </div>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {record.emailId ? (
              <Link
                href={`/emails/${record.emailId}`}
                className="font-medium text-teal-700 hover:underline"
              >
                Open source email
              </Link>
            ) : null}
            <span className="text-slate-500">Model: {record.modelName}</span>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Rows saved from this run
            </p>
            <SavedRowsSummary savedRowCounts={record.savedRowCounts} />
          </div>

          {record.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {record.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="space-y-4">
            {record.destinationGroups.map(({ destination, items }) => (
              <section
                key={destination.id}
                className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
              >
                <div className="space-y-1">
                  <h4 className="font-semibold text-slate-900">
                    {destination.title}
                  </h4>
                  <p className="text-sm text-slate-600">{destination.description}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {destination.dbTables.length > 0 ? (
                      <span>
                        <span className="font-medium text-slate-700">Tables:</span>{" "}
                        {destination.dbTables.join(", ")}
                      </span>
                    ) : null}
                    {destination.appPages.map((page) => (
                      <Link
                        key={page.href}
                        href={page.href}
                        className="text-teal-700 hover:underline"
                      >
                        {page.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <ul className="mt-3 space-y-2">
                  {items.map((item, index) => {
                    const fieldNote = destination.fieldNotes?.[item.fieldKey];
                    return (
                      <li
                        key={`${item.fieldKey}-${index}`}
                        className="rounded-md border border-slate-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-slate-500">
                            {item.fieldLabel}
                          </span>
                          <PersistBadge persisted={item.persisted} />
                        </div>
                        <p className="mt-1 text-sm text-slate-900">{item.summary}</p>
                        {item.sourceQuote ? (
                          <blockquote className="mt-2 border-l-2 border-slate-200 pl-3 text-xs italic text-slate-600">
                            &ldquo;{item.sourceQuote}&rdquo;
                          </blockquote>
                        ) : null}
                        {fieldNote ? (
                          <p className="mt-2 text-xs text-slate-500">{fieldNote}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Pagination({
  pagination,
}: {
  pagination: Props["pagination"];
}) {
  if (pagination.totalPages <= 1) return null;

  const prevPage = Math.max(1, pagination.page - 1);
  const nextPage = Math.min(pagination.totalPages, pagination.page + 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
      <p className="text-sm text-slate-600">
        Page {pagination.page} of {pagination.totalPages} · {pagination.totalCount}{" "}
        extraction{pagination.totalCount === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        {pagination.page > 1 ? (
          <Link
            href={`/emails/extractions?page=${prevPage}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Previous
          </Link>
        ) : null}
        {pagination.page < pagination.totalPages ? (
          <Link
            href={`/emails/extractions?page=${nextPage}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ExtractionAuditClient({ records, pagination }: Props) {
  const [activeTab, setActiveTab] = useState<AuditTabId>("extractions");

  const empty = useMemo(() => records.length === 0, [records.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AuditTabStrip active={activeTab} onChange={setActiveTab} />

      {activeTab === "routing" ? (
        <DestinationLegend />
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="font-medium text-slate-900">No email extractions yet</p>
          <p className="mt-2 text-sm text-slate-600">
            Process emails from the inbox to populate this audit view.
          </p>
          <Link
            href="/emails"
            className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline"
          >
            Go to inbox
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <AuditRecordCard key={record.id} record={record} />
          ))}
        </div>
      )}

      {activeTab === "extractions" ? <Pagination pagination={pagination} /> : null}
    </div>
  );
}
