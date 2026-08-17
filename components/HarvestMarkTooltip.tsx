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
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { HarvestTypeIcon } from "@/components/HarvestTypeIcon";
import {
  CONTACT_HIGHLIGHT_LABELS,
  entityCardDisplayName as contactCardDisplayName,
  type ContactEntityCard,
} from "@/lib/email-analysis/contact-highlight-shared";
import { EVENT_HIGHLIGHT_LABELS } from "@/lib/email-analysis/event-highlight-shared";
import type {
  HarvestMarkNode,
  HarvestSpan,
} from "@/lib/email-analysis/harvest-highlight-spans";
import {
  HARVEST_GROUP_SWATCH_CLASS,
  harvestIconFor,
  type HarvestGroupId,
} from "@/lib/email-analysis/harvest-highlight-theme";
import {
  resolveHarvestTooltipContent,
  type HarvestTooltipContent,
  type HarvestTooltipEvent,
} from "@/lib/email-analysis/harvest-tooltip-match";
import {
  ORG_HIGHLIGHT_LABELS,
  entityCardDisplayName as orgCardDisplayName,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  claimHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;
const HARVEST_MARK_ATTR = "data-harvest-mark";

const GROUP_TITLE: Record<HarvestGroupId, string> = {
  contact: "Contact",
  organization: "Organization",
  event: "Event",
  todo: "To-do",
};

const GROUP_HEADER_CLASS: Record<HarvestGroupId, string> = {
  contact: "bg-violet-50 text-violet-950 border-violet-100",
  organization: "bg-fuchsia-50 text-fuchsia-950 border-fuchsia-100",
  event: "bg-sky-50 text-sky-950 border-sky-100",
  todo: "bg-lime-50 text-lime-950 border-lime-100",
};

export type HarvestMarkTooltipData = {
  text: string;
  contactCards: ContactEntityCard[];
  orgCards: OrgEntityCard[];
  events: HarvestTooltipEvent[];
  todos: HarvestTooltipEvent[];
};

const HarvestMarkDataContext = createContext<HarvestMarkTooltipData | null>(
  null,
);

export function HarvestMarkDataProvider({
  value,
  children,
}: {
  value: HarvestMarkTooltipData;
  children: ReactNode;
}) {
  return (
    <HarvestMarkDataContext.Provider value={value}>
      {children}
    </HarvestMarkDataContext.Provider>
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

function layerLabel(group: HarvestGroupId, type: string): string {
  if (group === "contact") {
    return CONTACT_HIGHLIGHT_LABELS[
      type as keyof typeof CONTACT_HIGHLIGHT_LABELS
    ] ?? type;
  }
  if (group === "organization") {
    return ORG_HIGHLIGHT_LABELS[type as keyof typeof ORG_HIGHLIGHT_LABELS] ?? type;
  }
  if (group === "todo") return "To-do";
  return EVENT_HIGHLIGHT_LABELS[type as keyof typeof EVENT_HIGHLIGHT_LABELS] ?? type;
}

function layerValue(layerTitle: string, fallback: string): string {
  const idx = layerTitle.indexOf(": ");
  if (idx < 0) return fallback;
  const value = layerTitle.slice(idx + 2).trim();
  return value || fallback;
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

function TaggedChips({
  group,
  types,
}: {
  group: HarvestGroupId;
  types: string[];
}) {
  if (types.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1">
      {types.map((type) => (
        <span
          key={`${group}:${type}`}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${HARVEST_GROUP_SWATCH_CLASS[group]}`}
        >
          <HarvestTypeIcon
            icon={harvestIconFor(group, type)}
            className="h-3 w-3 shrink-0"
          />
          {layerLabel(group, type)}
        </span>
      ))}
    </div>
  );
}

function CardShell({
  group,
  type,
  title,
  children,
}: {
  group: HarvestGroupId;
  type: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <header
        className={`flex items-start gap-2 border-b px-3 py-2 ${GROUP_HEADER_CLASS[group]}`}
      >
        <HarvestTypeIcon
          icon={harvestIconFor(group, type)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {GROUP_TITLE[group]}
          </p>
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        </div>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function ContactTooltipCard({
  card,
  layers,
  highlightedText,
}: {
  card: ContactEntityCard | null;
  layers: HarvestSpan[];
  highlightedText: string;
}) {
  if (card) {
    return (
      <CardShell group="contact" type="contact_name" title={contactCardDisplayName(card)}>
        <dl className="space-y-1.5">
          <FieldRow label="First name" value={card.first_name} />
          <FieldRow label="Last name" value={card.last_name} />
          <FieldRow label="Email" value={card.email} />
          <FieldRow label="Phone" value={card.phone} />
          <FieldRow label="Job title" value={card.job_title} />
        </dl>
        <TaggedChips group="contact" types={layers.map((layer) => layer.type)} />
      </CardShell>
    );
  }

  const byType = new Map(
    layers.map((layer) => [
      layer.type,
      layerValue(layer.title, highlightedText),
    ]),
  );
  return (
    <CardShell
      group="contact"
      type={layers[0]?.type ?? "contact_name"}
      title={byType.get("contact_name") ?? highlightedText}
    >
      <dl className="space-y-1.5">
        {byType.has("contact_name") ? (
          <FieldRow label="Name" value={byType.get("contact_name") ?? null} />
        ) : null}
        {byType.has("job_title") ? (
          <FieldRow label="Job title" value={byType.get("job_title") ?? null} />
        ) : null}
        {byType.has("phone") ? (
          <FieldRow label="Phone" value={byType.get("phone") ?? null} />
        ) : null}
        {byType.has("company_name") ? (
          <FieldRow label="Company" value={byType.get("company_name") ?? null} />
        ) : null}
      </dl>
      <p className="mt-2 text-[10px] text-slate-400">From this highlight</p>
      <TaggedChips group="contact" types={layers.map((layer) => layer.type)} />
    </CardShell>
  );
}

function OrgTooltipCard({
  card,
  layers,
  highlightedText,
}: {
  card: OrgEntityCard | null;
  layers: HarvestSpan[];
  highlightedText: string;
}) {
  if (card) {
    return (
      <CardShell group="organization" type="organization_name" title={orgCardDisplayName(card)}>
        <dl className="space-y-1.5">
          <FieldRow label="Name" value={card.name} />
          <FieldRow label="Role" value={card.organization_role} />
          <FieldRow label="Email" value={card.email} />
          <FieldRow label="Phone" value={card.phone} />
          <FieldRow label="Website" value={card.website} />
        </dl>
        <TaggedChips
          group="organization"
          types={layers.map((layer) => layer.type)}
        />
      </CardShell>
    );
  }

  const byType = new Map(
    layers.map((layer) => [
      layer.type,
      layerValue(layer.title, highlightedText),
    ]),
  );
  return (
    <CardShell
      group="organization"
      type={layers[0]?.type ?? "organization_name"}
      title={byType.get("organization_name") ?? highlightedText}
    >
      <dl className="space-y-1.5">
        {byType.has("organization_name") ? (
          <FieldRow
            label="Name"
            value={byType.get("organization_name") ?? null}
          />
        ) : null}
        {byType.has("organization_role") ? (
          <FieldRow
            label="Role"
            value={byType.get("organization_role") ?? null}
          />
        ) : null}
        {byType.has("phone") ? (
          <FieldRow label="Phone" value={byType.get("phone") ?? null} />
        ) : null}
        {byType.has("website") ? (
          <FieldRow label="Website" value={byType.get("website") ?? null} />
        ) : null}
      </dl>
      <p className="mt-2 text-[10px] text-slate-400">From this highlight</p>
      <TaggedChips
        group="organization"
        types={layers.map((layer) => layer.type)}
      />
    </CardShell>
  );
}

function EventTooltipCard({
  event,
  layer,
  highlightedText,
}: {
  event: HarvestTooltipEvent | null;
  layer: HarvestSpan;
  highlightedText: string;
}) {
  const title = event?.title || layerValue(layer.title, highlightedText);
  const quote = event?.sourceQuote || highlightedText;
  return (
    <CardShell group="event" type={layer.type} title={title}>
      <dl className="space-y-1.5">
        <FieldRow label="Type" value={layerLabel("event", layer.type)} />
        {event?.when ? <FieldRow label="When" value={event.when} /> : null}
        {event?.detail ? <FieldRow label="Detail" value={event.detail} /> : null}
      </dl>
      {quote ? (
        <p className="mt-2 line-clamp-4 text-xs italic leading-snug text-slate-500">
          “{quote}”
        </p>
      ) : null}
      <TaggedChips group="event" types={[layer.type]} />
    </CardShell>
  );
}

function HarvestTooltipPanel({
  content,
  panelRef,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  content: HarvestTooltipContent;
  panelRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={style}
      className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="max-h-[min(24rem,calc(100vh-2rem))] divide-y divide-slate-200 overflow-y-auto">
        {content.contact ? (
          <ContactTooltipCard
            card={content.contact.card}
            layers={content.contact.layers}
            highlightedText={content.highlightedText}
          />
        ) : null}
        {content.organization ? (
          <OrgTooltipCard
            card={content.organization.card}
            layers={content.organization.layers}
            highlightedText={content.highlightedText}
          />
        ) : null}
        {content.events.map((entry, index) => (
          <EventTooltipCard
            key={`${entry.layer.type}:${index}`}
            event={entry.event}
            layer={entry.layer}
            highlightedText={content.highlightedText}
          />
        ))}
        {content.todos.map((entry, index) => (
          <EventTooltipCard
            key={`todo:${entry.layer.type}:${index}`}
            event={entry.event}
            layer={entry.layer}
            highlightedText={content.highlightedText}
          />
        ))}
      </div>
    </div>
  );
}

export function HarvestHoverMark({
  text,
  node,
  groupClassName,
  focused,
  children,
}: {
  text: string;
  node: HarvestMarkNode;
  groupClassName: string;
  focused: boolean;
  children: ReactNode;
}) {
  const data = useContext(HarvestMarkDataContext);
  const markRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("harvest-mark-tooltip")).current;
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 70,
  });

  const highlightedText = text.slice(node.start, node.end);
  const content = useMemo(
    () =>
      data
        ? resolveHarvestTooltipContent({
            node,
            highlightedText,
            bodyText: data.text,
            contactCards: data.contactCards,
            orgCards: data.orgCards,
            events: data.events,
            todos: data.todos,
          })
        : null,
    [data, highlightedText, node],
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
    if (!content) return;
    claimHoverPopover(popoverInstanceId, forceClose);
    cancelHide();
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!focused) return;
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused, text]);

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
  }, [open, content]);

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

  function isInnermostMark(event: MouseEvent<HTMLElement>): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return true;
    const innermost = target.closest(`[${HARVEST_MARK_ATTR}]`);
    return innermost === event.currentTarget;
  }

  return (
    <>
      <mark
        ref={markRef}
        data-harvest-mark=""
        className={`${groupClassName} cursor-help`}
        onMouseOver={(event) => {
          if (!isInnermostMark(event)) {
            triggerHoveredRef.current = false;
            return;
          }
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
      {open && content && typeof document !== "undefined"
        ? createPortal(
            <HarvestTooltipPanel
              content={content}
              panelRef={popoverRef}
              style={popoverStyle}
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}
