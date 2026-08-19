"use client";

import { useEffect, useMemo, useState } from "react";

import { HarvestMarkedBody } from "@/components/HarvestMarkedBody";
import { HarvestTypeIcon } from "@/components/HarvestTypeIcon";
import { SourceQuoteDisplay } from "@/components/SourceQuoteDisplay";
import type { EmailBodyDisplay } from "@/lib/email/format-body-display";
import { collapseEmailPlainWhitespace } from "@/lib/email/format-body-display";
import {
  CONTACT_HIGHLIGHT_LABELS,
  mergeContactHighlightExtractions,
  type ContactEntityCard,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  flattenEventHighlightExtraction,
  type EventExtractListItem,
} from "@/lib/email-analysis/event-highlight-run-display";
import {
  flattenTodoHighlightExtraction,
  type TodoExtractListItem,
} from "@/lib/email-analysis/todo-highlight-run-display";
import {
  emptyEventHighlightExtraction,
  EVENT_HIGHLIGHT_LABELS,
  mergeEventHighlightExtractions,
  type EventHighlightExtraction,
} from "@/lib/email-analysis/event-highlight-shared";
import {
  emptyTodoHighlightExtraction,
  mergeTodoHighlightExtractions,
  type TodoHighlightExtraction,
} from "@/lib/email-analysis/todo-highlight-shared";
import {
  HARVEST_GROUPS,
  HARVEST_GROUP_LABELS,
  HARVEST_GROUP_SWATCH_CLASS,
  harvestIconFor,
  type HarvestGroupId,
} from "@/lib/email-analysis/harvest-highlight-theme";
import {
  buildHarvestMarkTree,
  findFlexibleQuoteRange,
  resolveHarvestSpans,
} from "@/lib/email-analysis/harvest-highlight-spans";
import {
  mergeOrgHighlightExtractions,
  ORG_HIGHLIGHT_LABELS,
  type OrgEntityCard,
  type OrgHighlightExtraction,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  mergeProjectHighlightExtractions,
  PROJECT_HIGHLIGHT_LABELS,
  uniqueProjectHarvestCount,
  type ProjectEntityCard,
  type ProjectHighlightExtraction,
} from "@/lib/email-analysis/project-highlight-shared";
import { formatDateTime } from "@/lib/format/datetime";

export type ThreadHarvestPanelTarget = {
  threadId?: string | null;
  emailIds: string[];
  focusEmailId?: string | null;
  focusQuote?: string | null;
};

type Props = {
  target: ThreadHarvestPanelTarget | null;
  onClose: () => void;
};

type ThreadMessageHeader = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
};

type MessageBody = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  bodyDisplay: EmailBodyDisplay;
  bodyDisplayUnique?: EmailBodyDisplay | null;
};

type ContactRun = {
  extractions?: Record<string, ContactHighlightExtraction>;
  secondPass?: { extractions?: Record<string, ContactHighlightExtraction> } | null;
  thirdPass?: {
    entityCardsByEmailId?: Record<string, ContactEntityCard[]>;
  } | null;
  fourthPass?: { entityCards?: ContactEntityCard[] } | null;
};

type OrgRun = {
  extractions?: Record<string, OrgHighlightExtraction>;
  secondPass?: { extractions?: Record<string, OrgHighlightExtraction> } | null;
  thirdPass?: {
    entityCardsByEmailId?: Record<string, OrgEntityCard[]>;
  } | null;
  fourthPass?: { entityCards?: OrgEntityCard[] } | null;
};

type ProjectRun = {
  extractions?: Record<string, ProjectHighlightExtraction>;
  secondPass?: { extractions?: Record<string, ProjectHighlightExtraction> } | null;
  thirdPass?: {
    entityCardsByEmailId?: Record<string, ProjectEntityCard[]>;
  } | null;
  fourthPass?: { entityCards?: ProjectEntityCard[] } | null;
};

type EventRun = {
  extractions?: Record<string, EventHighlightExtraction>;
};

type TodoRun = {
  extractions?: Record<string, TodoHighlightExtraction>;
};

function emptyContact(): ContactHighlightExtraction {
  return {
    contact_names: [],
    phones: [],
    job_titles: [],
    company_names: [],
  };
}

function emptyOrg(): OrgHighlightExtraction {
  return {
    organization_names: [],
    phones: [],
    organization_roles: [],
    websites: [],
  };
}

function emptyProject(): ProjectHighlightExtraction {
  return {
    project_names: [],
    year_hints: [],
    phases: [],
    contractors: [],
    locations: [],
  };
}

function contactForEmail(
  runs: Record<string, ContactRun>,
  emailId: string,
): ContactHighlightExtraction {
  const parts: ContactHighlightExtraction[] = [];
  for (const run of Object.values(runs)) {
    if (run.extractions?.[emailId]) parts.push(run.extractions[emailId]!);
    if (run.secondPass?.extractions?.[emailId]) {
      parts.push(run.secondPass.extractions[emailId]!);
    }
  }
  return parts.length > 0 ? mergeContactHighlightExtractions(parts) : emptyContact();
}

function orgForEmail(
  runs: Record<string, OrgRun>,
  emailId: string,
): OrgHighlightExtraction {
  const parts: OrgHighlightExtraction[] = [];
  for (const run of Object.values(runs)) {
    if (run.extractions?.[emailId]) parts.push(run.extractions[emailId]!);
    if (run.secondPass?.extractions?.[emailId]) {
      parts.push(run.secondPass.extractions[emailId]!);
    }
  }
  return parts.length > 0 ? mergeOrgHighlightExtractions(parts) : emptyOrg();
}

function contactCardsForEmail(
  runs: Record<string, ContactRun>,
  emailId: string,
): ContactEntityCard[] {
  const cards: ContactEntityCard[] = [];
  for (const run of Object.values(runs)) {
    const third = run.thirdPass?.entityCardsByEmailId?.[emailId];
    if (third?.length) cards.push(...third);
    if (run.fourthPass?.entityCards?.length) {
      cards.push(...run.fourthPass.entityCards);
    }
  }
  return cards;
}

function orgCardsForEmail(
  runs: Record<string, OrgRun>,
  emailId: string,
): OrgEntityCard[] {
  const cards: OrgEntityCard[] = [];
  for (const run of Object.values(runs)) {
    const third = run.thirdPass?.entityCardsByEmailId?.[emailId];
    if (third?.length) cards.push(...third);
    if (run.fourthPass?.entityCards?.length) {
      cards.push(...run.fourthPass.entityCards);
    }
  }
  return cards;
}

function projectForEmail(
  runs: Record<string, ProjectRun>,
  emailId: string,
): ProjectHighlightExtraction {
  const parts: ProjectHighlightExtraction[] = [];
  for (const run of Object.values(runs)) {
    if (run.extractions?.[emailId]) parts.push(run.extractions[emailId]!);
    if (run.secondPass?.extractions?.[emailId]) {
      parts.push(run.secondPass.extractions[emailId]!);
    }
  }
  return parts.length > 0
    ? mergeProjectHighlightExtractions(parts)
    : emptyProject();
}

function projectCardsForEmail(
  runs: Record<string, ProjectRun>,
  emailId: string,
): ProjectEntityCard[] {
  const cards: ProjectEntityCard[] = [];
  for (const run of Object.values(runs)) {
    const third = run.thirdPass?.entityCardsByEmailId?.[emailId];
    if (third?.length) cards.push(...third);
    if (run.fourthPass?.entityCards?.length) {
      cards.push(...run.fourthPass.entityCards);
    }
  }
  return cards;
}

function eventsForEmail(
  runs: Record<string, EventRun>,
  emailId: string,
): EventExtractListItem[] {
  const parts: EventHighlightExtraction[] = [];
  for (const run of Object.values(runs)) {
    if (run.extractions?.[emailId]) parts.push(run.extractions[emailId]!);
  }
  const merged =
    parts.length > 0
      ? mergeEventHighlightExtractions(parts)
      : emptyEventHighlightExtraction();
  return flattenEventHighlightExtraction(emailId, merged).map((item) => ({
    type: item.type,
    title: item.title,
    when: item.when,
    detail: item.detail,
    emailId: item.emailId,
    sourceQuote: item.sourceQuote,
  }));
}

function todosForEmail(
  runs: Record<string, TodoRun>,
  emailId: string,
): TodoExtractListItem[] {
  const parts: TodoHighlightExtraction[] = [];
  for (const run of Object.values(runs)) {
    if (run.extractions?.[emailId]) parts.push(run.extractions[emailId]!);
  }
  const merged =
    parts.length > 0
      ? mergeTodoHighlightExtractions(parts)
      : emptyTodoHighlightExtraction();
  return flattenTodoHighlightExtraction(emailId, merged);
}

function resolveEvidenceBodyText(message: MessageBody): string {
  const unique = message.bodyDisplayUnique?.content?.trim();
  if (unique) {
    return collapseEmailPlainWhitespace(message.bodyDisplayUnique!.content);
  }
  return collapseEmailPlainWhitespace(message.bodyDisplay.content);
}

const HARVEST_TYPE_ROWS: Record<
  HarvestGroupId,
  Array<{ type: string; label: string }>
> = {
  contact: [
    { type: "contact_name", label: CONTACT_HIGHLIGHT_LABELS.contact_name },
    { type: "phone", label: CONTACT_HIGHLIGHT_LABELS.phone },
    { type: "job_title", label: CONTACT_HIGHLIGHT_LABELS.job_title },
    { type: "company_name", label: CONTACT_HIGHLIGHT_LABELS.company_name },
  ],
  organization: [
    { type: "organization_name", label: ORG_HIGHLIGHT_LABELS.organization_name },
    { type: "phone", label: ORG_HIGHLIGHT_LABELS.phone },
    { type: "organization_role", label: ORG_HIGHLIGHT_LABELS.organization_role },
    { type: "website", label: ORG_HIGHLIGHT_LABELS.website },
  ],
  project: [
    { type: "project_name", label: PROJECT_HIGHLIGHT_LABELS.project_name },
    { type: "year_hint", label: PROJECT_HIGHLIGHT_LABELS.year_hint },
    { type: "phase", label: PROJECT_HIGHLIGHT_LABELS.phase },
    { type: "contractor", label: PROJECT_HIGHLIGHT_LABELS.contractor },
    { type: "location", label: PROJECT_HIGHLIGHT_LABELS.location },
  ],
  event: [
    { type: "meeting", label: EVENT_HIGHLIGHT_LABELS.meeting },
    { type: "cancellation", label: EVENT_HIGHLIGHT_LABELS.cancellation },
    { type: "reschedule", label: EVENT_HIGHLIGHT_LABELS.reschedule },
    { type: "deadline", label: EVENT_HIGHLIGHT_LABELS.deadline },
    { type: "inspection", label: EVENT_HIGHLIGHT_LABELS.inspection },
    { type: "maintenance", label: EVENT_HIGHLIGHT_LABELS.maintenance },
  ],
  todo: [{ type: "action_item", label: "To-do" }],
};

function HarvestLegend() {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3">
      {HARVEST_GROUPS.map((group) => (
        <div key={group} className="min-w-0">
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS[group]}`}
          >
            {HARVEST_GROUP_LABELS[group]}
          </span>
          <ul className="mt-1.5 space-y-0.5 text-[10px] text-slate-600">
            {HARVEST_TYPE_ROWS[group].map((row) => (
              <li key={row.type} className="flex items-center gap-1">
                <HarvestTypeIcon
                  icon={harvestIconFor(group, row.type)}
                  className="h-3 w-3 shrink-0"
                />
                <span className="truncate">{row.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function HarvestEmailRow({
  header,
  defaultOpen,
  focusQuote,
  contact,
  org,
  project,
  events,
  todos,
  contactCards,
  orgCards,
  projectCards,
}: {
  header: ThreadMessageHeader;
  defaultOpen: boolean;
  focusQuote?: string | null;
  contact: ContactHighlightExtraction;
  org: OrgHighlightExtraction;
  project: ProjectHighlightExtraction;
  events: EventExtractListItem[];
  todos: TodoExtractListItem[];
  contactCards: ContactEntityCard[];
  orgCards: OrgEntityCard[];
  projectCards: ProjectEntityCard[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageBody | null>(null);

  useEffect(() => {
    if (!open || message) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/email/messages/${header.id}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          message?: MessageBody;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load email.");
        }
        return data.message!;
      })
      .then((loaded) => {
        if (!cancelled) setMessage(loaded);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load email.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, header.id, message]);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const bodyText = message ? resolveEvidenceBodyText(message) : "";
  const tree = useMemo(
    () =>
      buildHarvestMarkTree(
        resolveHarvestSpans({
          text: bodyText,
          contact,
          org,
          project,
          events: events.map((event) => ({
            type: event.type,
            title: event.title,
            sourceQuote: event.sourceQuote,
          })),
          todos: todos.map((todo) => ({
            title: todo.task,
            sourceQuote: todo.sourceQuote,
          })),
          focusQuote,
        }),
      ),
    [bodyText, contact, org, project, events, todos, focusQuote],
  );

  const unmatchedEventQuotes = events.filter((event) => {
    if (!event.sourceQuote?.trim() || !bodyText) return false;
    return findFlexibleQuoteRange(bodyText, event.sourceQuote) == null;
  });
  const unmatchedTodoQuotes = todos.filter((todo) => {
    if (!todo.sourceQuote?.trim() || !bodyText) return false;
    return findFlexibleQuoteRange(bodyText, todo.sourceQuote) == null;
  });

  const contactCount =
    contact.contact_names.length +
    contact.phones.length +
    contact.job_titles.length +
    contact.company_names.length;
  const orgCount =
    org.organization_names.length +
    org.phones.length +
    org.organization_roles.length +
    org.websites.length;
  const projectCount = uniqueProjectHarvestCount(projectCards, project);

  return (
    <li className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-slate-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">
            {header.subject || "(no subject)"}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {header.fromAddress} · {formatDateTime(header.receivedAt)}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            {contactCount > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS.contact}`}
              >
                {contactCount} contact
              </span>
            ) : null}
            {orgCount > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS.organization}`}
              >
                {orgCount} org
              </span>
            ) : null}
            {projectCount > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS.project}`}
              >
                {projectCount} project{projectCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {events.length > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS.event}`}
              >
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            ) : null}
            {todos.length > 0 ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${HARVEST_GROUP_SWATCH_CLASS.todo}`}
              >
                {todos.length} to-do{todos.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {loading ? (
            <p className="text-sm text-slate-500">Loading email…</p>
          ) : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {message ? (
            <>
              <p className="mb-2 text-xs text-slate-500">
                Authored content only (quoted reply history omitted)
              </p>
              {unmatchedEventQuotes.map((event) => (
                <div key={`${event.type}:${event.title}`} className="mb-3">
                  <p className="mb-1 text-xs text-slate-500">
                    {EVENT_HIGHLIGHT_LABELS[event.type]} quote was not found in
                    the authored body
                  </p>
                  <SourceQuoteDisplay quote={event.sourceQuote ?? ""} />
                </div>
              ))}
              {unmatchedTodoQuotes.map((todo) => (
                <div key={`todo:${todo.task}`} className="mb-3">
                  <p className="mb-1 text-xs text-slate-500">
                    To-do quote was not found in the authored body
                  </p>
                  <SourceQuoteDisplay quote={todo.sourceQuote ?? ""} />
                </div>
              ))}
              <HarvestMarkedBody
                text={bodyText}
                nodes={tree}
                contactCards={contactCards}
                orgCards={orgCards}
                projectCards={projectCards}
                events={events}
                todos={todos.map((todo) => ({
                  type: "action_item",
                  title: todo.task,
                  detail: todo.assignee,
                  sourceQuote: todo.sourceQuote,
                }))}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ThreadHarvestSidePanel({ target, onClose }: Props) {
  const [headers, setHeaders] = useState<ThreadMessageHeader[]>([]);
  const [contactRuns, setContactRuns] = useState<Record<string, ContactRun>>({});
  const [orgRuns, setOrgRuns] = useState<Record<string, OrgRun>>({});
  const [projectRuns, setProjectRuns] = useState<Record<string, ProjectRun>>({});
  const [eventRuns, setEventRuns] = useState<Record<string, EventRun>>({});
  const [todoRuns, setTodoRuns] = useState<Record<string, TodoRun>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, onClose]);

  useEffect(() => {
    if (!target) {
      setHeaders([]);
      setContactRuns({});
      setOrgRuns({});
      setProjectRuns({});
      setEventRuns({});
      setTodoRuns({});
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const panel = target;
    const emailIds = [...new Set(panel.emailIds.filter(Boolean))];
    const emailQuery = emailIds.join(",");

    async function load() {
      const loadedHeaders = panel.threadId
        ? await fetch(`/api/email/threads/${panel.threadId}`).then(
            async (response) => {
              const data = (await response.json()) as {
                messages?: ThreadMessageHeader[];
                error?: string;
              };
              if (!response.ok) {
                throw new Error(data.error ?? "Could not load thread.");
              }
              const messages = [...(data.messages ?? [])].sort((a, b) =>
                a.receivedAt.localeCompare(b.receivedAt),
              );
              return messages.map((message) => ({
                id: message.id,
                subject: message.subject,
                fromAddress: message.fromAddress,
                receivedAt: message.receivedAt,
              }));
            },
          )
        : await Promise.all(
            emailIds.map(async (id) => {
              const response = await fetch(`/api/email/messages/${id}`);
              const data = (await response.json()) as {
                message?: ThreadMessageHeader;
                error?: string;
              };
              if (!response.ok || !data.message) {
                throw new Error(data.error ?? "Could not load email.");
              }
              return {
                id: data.message.id,
                subject: data.message.subject,
                fromAddress: data.message.fromAddress,
                receivedAt: data.message.receivedAt,
              };
            }),
          ).then((messages) =>
            [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
          );

      const harvestIds =
        loadedHeaders.map((header) => header.id).join(",") || emailQuery;
      const [contacts, orgs, projects, events, todos] = await Promise.all([
        harvestIds
          ? fetch(`/api/analysis/extract-contacts?emailIds=${encodeURIComponent(harvestIds)}`)
              .then(async (response) => {
                const data = (await response.json()) as {
                  runs?: Record<string, ContactRun>;
                };
                return data.runs ?? {};
              })
              .catch(() => ({} as Record<string, ContactRun>))
          : {},
        harvestIds
          ? fetch(
              `/api/analysis/extract-organizations?emailIds=${encodeURIComponent(harvestIds)}`,
            )
              .then(async (response) => {
                const data = (await response.json()) as {
                  runs?: Record<string, OrgRun>;
                };
                return data.runs ?? {};
              })
              .catch(() => ({} as Record<string, OrgRun>))
          : {},
        harvestIds
          ? fetch(
              `/api/analysis/extract-projects?emailIds=${encodeURIComponent(harvestIds)}`,
            )
              .then(async (response) => {
                const data = (await response.json()) as {
                  runs?: Record<string, ProjectRun>;
                };
                return data.runs ?? {};
              })
              .catch(() => ({} as Record<string, ProjectRun>))
          : {},
        harvestIds
          ? fetch(`/api/analysis/extract-events?emailIds=${encodeURIComponent(harvestIds)}`)
              .then(async (response) => {
                const data = (await response.json()) as {
                  runs?: Record<string, EventRun>;
                };
                return data.runs ?? {};
              })
              .catch(() => ({} as Record<string, EventRun>))
          : {},
        harvestIds
          ? fetch(`/api/analysis/extract-todos?emailIds=${encodeURIComponent(harvestIds)}`)
              .then(async (response) => {
                const data = (await response.json()) as {
                  runs?: Record<string, TodoRun>;
                };
                return data.runs ?? {};
              })
              .catch(() => ({} as Record<string, TodoRun>))
          : {},
      ]);

      if (cancelled) return;
      const idsForHarvest = loadedHeaders.map((header) => header.id);
      const missing = emailIds.filter((id) => !idsForHarvest.includes(id));
      setHeaders(
        missing.length === 0
          ? loadedHeaders
          : [
              ...loadedHeaders,
              ...missing.map((id) => ({
                id,
                subject: "(email)",
                fromAddress: "",
                receivedAt: "",
              })),
            ],
      );
      setContactRuns(contacts);
      setOrgRuns(orgs);
      setProjectRuns(projects);
      setEventRuns(events);
      setTodoRuns(todos);
    }

    load()
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load harvest highlights.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  const focusEmailId = target.focusEmailId ?? headers[0]?.id ?? null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close harvest highlight panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-harvest-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Thread harvest
            </p>
            <h2
              id="thread-harvest-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              Extraction highlights
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {headers.length} email{headers.length === 1 ? "" : "s"} · color is
              the harvest group, icon is the type
            </p>
            <HarvestLegend />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-slate-500">Loading thread…</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-700">{error}</p> : null}
          {!loading && headers.length === 0 && !error ? (
            <p className="p-4 text-sm text-slate-500">No emails in this thread.</p>
          ) : null}
          <ul>
            {headers.map((header) => (
              <HarvestEmailRow
                key={header.id}
                header={header}
                defaultOpen={header.id === focusEmailId}
                focusQuote={
                  header.id === focusEmailId ? target.focusQuote : null
                }
                contact={contactForEmail(contactRuns, header.id)}
                org={orgForEmail(orgRuns, header.id)}
                project={projectForEmail(projectRuns, header.id)}
                events={eventsForEmail(eventRuns, header.id)}
                todos={todosForEmail(todoRuns, header.id)}
                contactCards={contactCardsForEmail(contactRuns, header.id)}
                orgCards={orgCardsForEmail(orgRuns, header.id)}
                projectCards={projectCardsForEmail(projectRuns, header.id)}
              />
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
