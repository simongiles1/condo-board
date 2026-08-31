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
import { RolePhraseBadge } from "@/components/EntityMentionBadges";
import { useEntityProfile } from "@/components/EntityProfileProvider";
import {
  unlinkedOrganizationProfile,
  unlinkedPersonProfile,
  unlinkedProjectProfile,
  type EntityProfilePayload,
  type EntityProfileResolveHint,
} from "@/lib/entities/entity-profile-shared";
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
  HARVEST_FOCUS_MARK_CLASS,
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
  PROJECT_HIGHLIGHT_LABELS,
  projectCardDisplayName,
  type ProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";
import { uniqueByCanonicalOrgName } from "@/lib/organizations/org-name-fuzzy";
import { HOVER_POPOVER_ATTR } from "@/lib/ui/hover-popover-group";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

const VIEWPORT_MARGIN = 8;
const HARVEST_MARK_ATTR = "data-harvest-mark";

const GROUP_TITLE: Record<HarvestGroupId, string> = {
  contact: "Contact",
  organization: "Organization",
  project: "Project",
  event: "Event",
  todo: "To-do",
};

const GROUP_HEADER_CLASS: Record<HarvestGroupId, string> = {
  contact: "bg-violet-50 text-violet-950 border-violet-100",
  organization: "bg-fuchsia-50 text-fuchsia-950 border-fuchsia-100",
  project: "bg-orange-50 text-orange-950 border-orange-100",
  event: "bg-sky-50 text-sky-950 border-sky-100",
  todo: "bg-lime-50 text-lime-950 border-lime-100",
};

export type HarvestMarkTooltipData = {
  text: string;
  contactCards: ContactEntityCard[];
  orgCards: OrgEntityCard[];
  projectCards: ProjectEntityCard[];
  events: HarvestTooltipEvent[];
  todos: HarvestTooltipEvent[];
  reloadMentions?: () => void;
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
  if (group === "project") {
    return PROJECT_HIGHLIGHT_LABELS[type as keyof typeof PROJECT_HIGHLIGHT_LABELS] ?? type;
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

function harvestOpenFromGroup(
  content: HarvestTooltipContent,
  group: HarvestGroupId,
): { hint: EntityProfileResolveHint; fallback: EntityProfilePayload } | null {
  if (group === "contact" && content.contact) {
    const card = content.contact.card;
    const name =
      (card ? contactCardDisplayName(card) : null) ||
      content.highlightedText;
    return {
      hint: {
        kind: "person",
        email: card?.email ?? null,
        phone: card?.phone ?? null,
        firstName: card?.first_name ?? null,
        lastName: card?.last_name ?? null,
        name,
      },
      fallback: unlinkedPersonProfile({
        displayName: name,
        firstName: card?.first_name ?? null,
        lastName: card?.last_name ?? null,
        title: card?.job_title ?? null,
        email: card?.email ?? null,
        phone: card?.phone ?? null,
        organizationName: card?.raw_company ?? null,
      }),
    };
  }
  if (group === "organization" && content.organization) {
    const card = content.organization.card;
    const name =
      (card ? orgCardDisplayName(card) : null) || content.highlightedText;
    return {
      hint: { kind: "organization", name: card?.name ?? name },
      fallback: unlinkedOrganizationProfile({
        displayName: name,
        role: card?.organization_role ?? null,
        email: card?.email ?? null,
        phone: card?.phone ?? null,
        website: card?.website ?? null,
      }),
    };
  }
  if (group === "project" && content.project) {
    const card = content.project.card;
    const name =
      (card ? projectCardDisplayName(card) : null) || content.highlightedText;
    return {
      hint: {
        kind: "project",
        name: card?.name ?? name,
        yearHint: card?.year_hint ?? null,
      },
      fallback: unlinkedProjectProfile({
        displayName: name,
        yearHint: card?.year_hint ?? null,
        phase: card?.phase ?? null,
        contractor: card?.contractor ?? null,
        location: card?.location ?? null,
        equipmentMentions: card?.equipment_mentions ?? null,
      }),
    };
  }
  return null;
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

function RoleField({ jobTitle }: { jobTitle: string | null | undefined }) {
  if (!jobTitle?.trim()) return null;
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs leading-snug">
      <dt className="text-slate-500">Role</dt>
      <dd className="min-w-0">
        <RolePhraseBadge jobTitle={jobTitle} />
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

function CandidatePickList({
  mentionId,
  group,
  candidates,
  onPicked,
}: {
  mentionId: string;
  group: "organization" | "contact";
  candidates: Array<{ id: string; name: string }>;
  onPicked?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (candidates.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Unresolved · pick one
      </p>
      {uniqueByCanonicalOrgName(candidates).map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          disabled={busyId != null}
          className="block w-full rounded-md px-2 py-1 text-left text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void (async () => {
              setBusyId(candidate.id);
              setError(null);
              const url =
                group === "organization"
                  ? "/api/organizations/mentions/confirm"
                  : "/api/contacts/mentions/confirm";
              const body =
                group === "organization"
                  ? { mentionId, organizationId: candidate.id }
                  : { mentionId, personId: candidate.id };
              const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const data = (await response.json()) as { error?: string };
              setBusyId(null);
              if (!response.ok) {
                setError(data.error ?? "Could not confirm.");
                return;
              }
              onPicked?.();
            })();
          }}
        >
          {busyId === candidate.id ? "Saving…" : candidate.name}
        </button>
      ))}
      {error ? <p className="text-[10px] text-rose-700">{error}</p> : null}
    </div>
  );
}

function unresolvedPick(
  layers: HarvestSpan[],
): { mentionId: string; candidates: Array<{ id: string; name: string }> } | null {
  const layer = layers.find(
    (row) => row.unresolved && row.mentionId && (row.candidates?.length ?? 0) > 0,
  );
  if (!layer?.mentionId) return null;
  return { mentionId: layer.mentionId, candidates: layer.candidates ?? [] };
}

function CardShell({
  group,
  type,
  title,
  onOpen,
  children,
}: {
  group: HarvestGroupId;
  type: string;
  title: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={onOpen ? "cursor-pointer" : undefined}
      onClick={onOpen}
    >
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
  onOpen,
  onPicked,
}: {
  card: ContactEntityCard | null;
  layers: HarvestSpan[];
  highlightedText: string;
  onOpen?: () => void;
  onPicked?: () => void;
}) {
  const pick = unresolvedPick(layers);
  if (card) {
    return (
      <CardShell
        group="contact"
        type="contact_name"
        title={contactCardDisplayName(card)}
        onOpen={onOpen}
      >
        <dl className="space-y-1.5">
          <FieldRow label="First name" value={card.first_name} />
          <FieldRow label="Last name" value={card.last_name} />
          <FieldRow label="Email" value={card.email} />
          <FieldRow label="Phone" value={card.phone} />
          <FieldRow label="Job title" value={card.job_title} />
          <RoleField jobTitle={card.job_title} />
        </dl>
        <TaggedChips group="contact" types={layers.map((layer) => layer.type)} />
        {pick ? (
          <CandidatePickList
            mentionId={pick.mentionId}
            group="contact"
            candidates={pick.candidates}
            onPicked={onPicked}
          />
        ) : null}
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
      onOpen={onOpen}
    >
      <dl className="space-y-1.5">
        {byType.has("contact_name") ? (
          <FieldRow label="Name" value={byType.get("contact_name") ?? null} />
        ) : null}
        {byType.has("job_title") ? (
          <>
            <FieldRow label="Job title" value={byType.get("job_title") ?? null} />
            <RoleField jobTitle={byType.get("job_title") ?? null} />
          </>
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
      {pick ? (
        <CandidatePickList
          mentionId={pick.mentionId}
          group="contact"
          candidates={pick.candidates}
          onPicked={onPicked}
        />
      ) : null}
    </CardShell>
  );
}

function OrgTooltipCard({
  card,
  layers,
  highlightedText,
  onOpen,
  onPicked,
}: {
  card: OrgEntityCard | null;
  layers: HarvestSpan[];
  highlightedText: string;
  onOpen?: () => void;
  onPicked?: () => void;
}) {
  const pick = unresolvedPick(layers);
  if (card) {
    return (
      <CardShell
        group="organization"
        type="organization_name"
        title={orgCardDisplayName(card)}
        onOpen={onOpen}
      >
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
        {pick ? (
          <CandidatePickList
            mentionId={pick.mentionId}
            group="organization"
            candidates={pick.candidates}
            onPicked={onPicked}
          />
        ) : null}
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
      onOpen={onOpen}
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
      {pick ? (
        <CandidatePickList
          mentionId={pick.mentionId}
          group="organization"
          candidates={pick.candidates}
          onPicked={onPicked}
        />
      ) : null}
    </CardShell>
  );
}

function ProjectTooltipCard({
  card,
  layers,
  highlightedText,
  onOpen,
}: {
  card: ProjectEntityCard | null;
  layers: HarvestSpan[];
  highlightedText: string;
  onOpen?: () => void;
}) {
  if (card) {
    return (
      <CardShell
        group="project"
        type="project_name"
        title={projectCardDisplayName(card)}
        onOpen={onOpen}
      >
        <dl className="space-y-1.5">
          <FieldRow label="Name" value={card.name} />
          <FieldRow label="Years" value={card.year_hint} />
          <FieldRow label="Phase" value={card.phase} />
          <FieldRow label="Contractor" value={card.contractor} />
          <FieldRow label="Location" value={card.location} />
          <FieldRow label="Equipment" value={card.equipment_mentions} />
        </dl>
        <TaggedChips
          group="project"
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
      group="project"
      type={layers[0]?.type ?? "project_name"}
      title={byType.get("project_name") ?? highlightedText}
      onOpen={onOpen}
    >
      <dl className="space-y-1.5">
        {byType.has("project_name") ? (
          <FieldRow
            label="Name"
            value={byType.get("project_name") ?? null}
          />
        ) : null}
        {byType.has("year_hint") ? (
          <FieldRow label="Years" value={byType.get("year_hint") ?? null} />
        ) : null}
        {byType.has("phase") ? (
          <FieldRow label="Phase" value={byType.get("phase") ?? null} />
        ) : null}
        {byType.has("contractor") ? (
          <FieldRow
            label="Contractor"
            value={byType.get("contractor") ?? null}
          />
        ) : null}
        {byType.has("location") ? (
          <FieldRow label="Location" value={byType.get("location") ?? null} />
        ) : null}
      </dl>
      <p className="mt-2 text-[10px] text-slate-400">From this highlight</p>
      <TaggedChips
        group="project"
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
  const group = layer.group === "todo" ? "todo" : "event";
  const title = event?.title || layerValue(layer.title, highlightedText);
  const quote = event?.sourceQuote || highlightedText;
  return (
    <CardShell group={group} type={layer.type} title={title}>
      <dl className="space-y-1.5">
        <FieldRow label="Type" value={layerLabel(group, layer.type)} />
        {event?.when ? <FieldRow label="When" value={event.when} /> : null}
        {event?.detail ? (
          <FieldRow
            label={group === "todo" ? "Assignee" : "Detail"}
            value={event.detail}
          />
        ) : null}
      </dl>
      {quote ? (
        <p className="mt-2 line-clamp-4 text-xs italic leading-snug text-slate-500">
          “{quote}”
        </p>
      ) : null}
      <TaggedChips group={group} types={[layer.type]} />
    </CardShell>
  );
}

function HarvestTooltipPanel({
  content,
  panelRef,
  style,
  onMouseEnter,
  onMouseLeave,
  onOpenGroup,
  onPicked,
}: {
  content: HarvestTooltipContent;
  panelRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenGroup: (group: HarvestGroupId) => void;
  onPicked?: () => void;
}) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={style}
      className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      {...{ [HOVER_POPOVER_ATTR]: "" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="max-h-[min(24rem,calc(100vh-2rem))] divide-y divide-slate-200 overflow-y-auto">
        {content.contact ? (
          <ContactTooltipCard
            card={content.contact.card}
            layers={content.contact.layers}
            highlightedText={content.highlightedText}
            onOpen={() => onOpenGroup("contact")}
            onPicked={onPicked}
          />
        ) : null}
        {content.organization ? (
          <OrgTooltipCard
            card={content.organization.card}
            layers={content.organization.layers}
            highlightedText={content.highlightedText}
            onOpen={() => onOpenGroup("organization")}
            onPicked={onPicked}
          />
        ) : null}
        {content.project ? (
          <ProjectTooltipCard
            card={content.project.card}
            layers={content.project.layers}
            highlightedText={content.highlightedText}
            onOpen={() => onOpenGroup("project")}
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
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 70,
  });

  const { openHarvestProfile } = useEntityProfile();
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
            projectCards: data.projectCards,
            events: data.events,
            todos: data.todos,
          })
        : null,
    [data, highlightedText, node],
  );
  const hover = useHoverPopover({ enabled: Boolean(content) });

  useLayoutEffect(() => {
    if (!focused) return;
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused, text]);

  useLayoutEffect(() => {
    if (!hover.open || !markRef.current || !popoverRef.current) return;
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
  }, [hover.open, content]);

  useEffect(() => {
    if (!hover.open) return;

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

    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [hover.open]);

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
        className={`${focused ? HARVEST_FOCUS_MARK_CLASS : groupClassName} cursor-pointer`}
        {...(focused ? { "data-source-quote-mark": "" } : {})}
        onMouseOver={(event) => {
          if (!isInnermostMark(event)) {
            hover.onTriggerLeave();
            return;
          }
          hover.onTriggerEnter();
        }}
        onMouseLeave={hover.onTriggerLeave}
        onClick={(event) => {
          if (!isInnermostMark(event)) return;
          event.preventDefault();
          event.stopPropagation();
          if (!content) return;
          const open = harvestOpenFromGroup(content, content.primaryGroup);
          if (!open) return;
          hover.forceClose();
          void openHarvestProfile(open.hint, open.fallback);
        }}
      >
        {children}
      </mark>
      {hover.open && content && typeof document !== "undefined"
        ? createPortal(
            <HarvestTooltipPanel
              content={content}
              panelRef={popoverRef}
              style={popoverStyle}
              onMouseEnter={hover.onPopoverEnter}
              onMouseLeave={hover.onPopoverLeave}
              onPicked={data?.reloadMentions}
              onOpenGroup={(group) => {
                const open = harvestOpenFromGroup(content, group);
                if (!open) return;
                hover.forceClose();
                void openHarvestProfile(open.hint, open.fallback);
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}
