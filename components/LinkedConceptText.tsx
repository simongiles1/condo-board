"use client";

import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { HarvestTypeIcon } from "@/components/HarvestTypeIcon";
import {
  buildConceptMatcher,
  findConceptLinkSpans,
  formatConceptEventDate,
  getConceptsForSpan,
  type ConceptLinkSpan,
  type ConceptMatcher,
  type LinkedConcept,
  type LinkedConceptKind,
} from "@/lib/entities/concept-links";
import { calendarEventTypeLabel } from "@/lib/calendar/event-types";
import { calendarHref } from "@/lib/calendar/grid";
import {
  EVENT_HARVEST_ICONS,
  HARVEST_GROUP_MARK_CLASS,
  type HarvestIconId,
} from "@/lib/email-analysis/harvest-highlight-theme";
import {
  claimHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;

const KIND_LABEL: Record<LinkedConceptKind, string> = {
  person: "Person",
  organization: "Organization",
  equipment: "Equipment",
  event: "Calendar event",
};

const KIND_ICON: Record<LinkedConceptKind, HarvestIconId> = {
  person: "person",
  organization: "building",
  equipment: "wrench",
  event: "calendar",
};

const KIND_MARK_CLASS: Record<LinkedConceptKind, string> = {
  person: HARVEST_GROUP_MARK_CLASS.contact,
  organization: HARVEST_GROUP_MARK_CLASS.organization,
  equipment:
    "rounded-sm bg-amber-200/90 text-amber-950 ring-1 ring-amber-300/50 box-decoration-clone px-0.5",
  event: HARVEST_GROUP_MARK_CLASS.event,
};

const KIND_HEADER_CLASS: Record<LinkedConceptKind, string> = {
  person: "bg-violet-50 text-violet-950 border-violet-100",
  organization: "bg-fuchsia-50 text-fuchsia-950 border-fuchsia-100",
  equipment: "bg-amber-50 text-amber-950 border-amber-100",
  event: "bg-sky-50 text-sky-950 border-sky-100",
};

const EVENT_TYPE_MARK_CLASS: Record<string, string> = {
  meeting: HARVEST_GROUP_MARK_CLASS.event,
  inspection:
    "rounded-sm bg-teal-200/90 text-teal-950 ring-1 ring-teal-300/50 box-decoration-clone px-0.5",
  maintenance:
    "rounded-sm bg-orange-200/90 text-orange-950 ring-1 ring-orange-300/50 box-decoration-clone px-0.5",
  deadline:
    "rounded-sm bg-violet-200/90 text-violet-950 ring-1 ring-violet-300/50 box-decoration-clone px-0.5",
};

function markClassForConcepts(
  span: ConceptLinkSpan,
  concepts: LinkedConcept[],
): string {
  if (span.kind === "event") {
    const eventType = concepts[0]?.event?.eventType;
    if (eventType && EVENT_TYPE_MARK_CLASS[eventType]) {
      return EVENT_TYPE_MARK_CLASS[eventType];
    }
  }
  return KIND_MARK_CLASS[span.kind];
}

function iconForConcept(concept: LinkedConcept): HarvestIconId {
  if (concept.kind === "event") {
    return EVENT_HARVEST_ICONS[concept.event?.eventType ?? ""] ?? "calendar";
  }
  return KIND_ICON[concept.kind];
}

const ConceptLinkContext = createContext<ConceptMatcher | null>(null);

export function ConceptLinkProvider({
  concepts,
  children,
}: {
  concepts: LinkedConcept[];
  children: ReactNode;
}) {
  const matcher = useMemo(() => buildConceptMatcher(concepts), [concepts]);
  return (
    <ConceptLinkContext.Provider value={matcher}>
      {children}
    </ConceptLinkContext.Provider>
  );
}

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const showBelow = spaceBelow >= popoverHeight || spaceBelow >= spaceAbove;

  let top = showBelow
    ? triggerRect.bottom + 6
    : triggerRect.top - popoverHeight - 6;
  top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(top, viewportHeight - popoverHeight - VIEWPORT_MARGIN),
  );

  let left = triggerRect.left;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, viewportWidth - popoverWidth - VIEWPORT_MARGIN),
  );

  return {
    position: "fixed",
    top,
    left,
    zIndex: 70,
  };
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs leading-snug">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">
        {value?.trim() ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function ConceptCard({ concept }: { concept: LinkedConcept }) {
  const eventDay = concept.event?.startAt.slice(0, 10) ?? null;
  return (
    <section>
      <header
        className={`flex items-start gap-2 border-b px-3 py-2 ${KIND_HEADER_CLASS[concept.kind]}`}
      >
        <HarvestTypeIcon
          icon={iconForConcept(concept)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {concept.kind === "event" && concept.event
              ? calendarEventTypeLabel(concept.event.eventType)
              : KIND_LABEL[concept.kind]}
          </p>
          <h3 className="text-sm font-semibold leading-snug">
            {concept.displayName}
          </h3>
        </div>
      </header>
      <div className="px-3 py-2.5">
        {concept.kind === "person" ? (
          <dl className="space-y-1.5">
            <FieldRow label="First name" value={concept.person?.firstName ?? null} />
            <FieldRow label="Last name" value={concept.person?.lastName ?? null} />
            <FieldRow label="Email" value={concept.person?.email ?? null} />
            <FieldRow label="Phone" value={concept.person?.phone ?? null} />
            <FieldRow label="Job title" value={concept.person?.title ?? null} />
            <FieldRow
              label="Organization"
              value={concept.person?.organizationName ?? null}
            />
          </dl>
        ) : null}
        {concept.kind === "organization" ? (
          <dl className="space-y-1.5">
            <FieldRow label="Name" value={concept.organization?.name ?? null} />
            <FieldRow label="Role" value={concept.organization?.role ?? null} />
            <FieldRow label="Email" value={concept.organization?.email ?? null} />
            <FieldRow label="Phone" value={concept.organization?.phone ?? null} />
            <FieldRow
              label="Website"
              value={concept.organization?.website ?? null}
            />
          </dl>
        ) : null}
        {concept.kind === "equipment" ? (
          <dl className="space-y-1.5">
            <FieldRow label="Name" value={concept.equipment?.name ?? null} />
            <FieldRow
              label="Manufacturer"
              value={concept.equipment?.manufacturer ?? null}
            />
            <FieldRow
              label="Category"
              value={concept.equipment?.category ?? null}
            />
            <FieldRow
              label="Location"
              value={concept.equipment?.location ?? null}
            />
            <FieldRow label="Kind" value={concept.equipment?.kind ?? null} />
            <FieldRow label="Notes" value={concept.equipment?.notes ?? null} />
          </dl>
        ) : null}
        {concept.kind === "event" && concept.event ? (
          <dl className="space-y-1.5">
            <FieldRow
              label="When"
              value={formatConceptEventDate(concept.event.startAt)}
            />
            <FieldRow
              label="Type"
              value={calendarEventTypeLabel(concept.event.eventType)}
            />
            <FieldRow label="Notes" value={concept.event.description} />
            {eventDay ? (
              <div className="pt-1">
                <a
                  href={calendarHref("month", eventDay)}
                  className="text-xs font-medium text-sky-800 underline decoration-sky-300 underline-offset-2 hover:text-sky-950"
                >
                  View on calendar
                </a>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function LinkedConceptMark({
  span,
  matcher,
  children,
}: {
  span: ConceptLinkSpan;
  matcher: ConceptMatcher;
  children: ReactNode;
}) {
  const markRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("linked-concept-popover")).current;
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 70,
  });

  const concepts = useMemo(
    () => getConceptsForSpan(span, matcher),
    [span, matcher],
  );

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function forceClose() {
    cancelHide();
    triggerHoveredRef.current = false;
    popoverHoveredRef.current = false;
    setOpen(false);
    releaseHoverPopover(popoverInstanceId);
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (!triggerHoveredRef.current && !popoverHoveredRef.current) {
        forceClose();
      }
    }, POPOVER_HIDE_DELAY_MS);
  }

  function showPopover() {
    if (concepts.length === 0) return;
    claimHoverPopover(popoverInstanceId, forceClose);
    cancelHide();
    setOpen(true);
  }

  useEffect(() => {
    return () => {
      cancelHide();
      releaseHoverPopover(popoverInstanceId);
    };
  }, [popoverInstanceId]);

  useLayoutEffect(() => {
    if (!open || !markRef.current || !popoverRef.current) return;
    const triggerRect = markRef.current.getBoundingClientRect();
    const popover = popoverRef.current;
    setPopoverStyle({
      ...computePopoverPosition(
        triggerRect,
        popover.offsetWidth,
        popover.offsetHeight,
      ),
      visibility: "visible",
    });
  }, [open, concepts]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const triggerRect = markRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;
      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
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
  }, [open]);

  return (
    <>
      <mark
        ref={markRef}
        className={`${markClassForConcepts(span, concepts)} cursor-help`}
        onMouseEnter={() => {
          triggerHoveredRef.current = true;
          showPopover();
        }}
        onMouseLeave={() => {
          triggerHoveredRef.current = false;
          scheduleHide();
        }}
      >
        {children}
      </mark>
      {open && concepts.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <div className="max-h-[min(24rem,calc(100vh-2rem))] divide-y divide-slate-200 overflow-y-auto">
                {concepts.map((concept) => (
                  <ConceptCard key={concept.id} concept={concept} />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function LinkedConceptText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const matcher = useContext(ConceptLinkContext);
  const spans = useMemo(
    () => (matcher ? findConceptLinkSpans(text, matcher) : []),
    [matcher, text],
  );

  if (!matcher || spans.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) {
      parts.push(text.slice(cursor, span.start));
    }
    parts.push(
      <LinkedConceptMark
        key={`${span.start}:${span.end}:${span.conceptIds.join(",")}:${index}`}
        span={span}
        matcher={matcher}
      >
        {text.slice(span.start, span.end)}
      </LinkedConceptMark>,
    );
    cursor = span.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <span className={className}>{parts}</span>;
}
