/**
 * Curated build-out status for the Dev Tools progress popup.
 *
 * Statuses and the playbook are product truth, not live corpus counts. Update
 * this file when a stage ships, a blocker lifts, or the next-up order changes.
 * The extraction calendar already tracks per-email coverage.
 */

export type BuildoutStatus =
  | "done"
  | "in_progress"
  | "not_started"
  | "deferred";

export type BuildoutItem = {
  id: string;
  /** Short stage label such as "1" or "2B". Omitted for cross-cutting work. */
  stage: string | null;
  title: string;
  status: BuildoutStatus;
  summary: string;
  remaining: string[];
};

/** When to tackle a playbook step relative to the rest of the board. */
export type BuildoutSequenceKind =
  | "now"
  | "parallel"
  | "blocked"
  | "after"
  | "later";

export type BuildoutSequenceStep = {
  id: string;
  kind: BuildoutSequenceKind;
  title: string;
  detail: string;
  /** Matching `BuildoutItem.id` values so the playbook points at the cards below. */
  relatedIds: string[];
};

export const BUILDOUT_REVIEWED_ON = "2026-08-16";

/**
 * Corpus snapshot for the playbook header. Not queried live — refresh when
 * reviewing this file. Exact coverage belongs on the extraction calendar.
 */
export const BUILDOUT_COVERAGE_SNAPSHOT = {
  asOf: "2026-08-16",
  emails: 7331,
  contactsExtracted: 7331,
  orgsExtracted: 7320,
  eventsExtracted: 7306,
  todosExtracted: 22,
  visionPagesDone: 2345,
  visionPagesTotal: 6614,
  visionPagesRemaining: 4269,
  visionSpendCapFailed: 3959,
  affiliationsPending: 266,
  affiliationsApproved: 0,
} as const;

/** Ordered extraction stages the harvest pipeline is built around. */
export const BUILDOUT_STAGES: BuildoutItem[] = [
  {
    id: "contacts",
    stage: "1",
    title: "Contacts",
    status: "done",
    summary:
      "Person highlight harvest, fingerprints, registry, merge, and mention chart. Inbox and bulk extract run on email bodies.",
    remaining: [
      "Harvest still skips attachment text (Docling markdown is stored, not mined).",
      "Hover cards exist; click-through to a full person profile is not wired.",
    ],
  },
  {
    id: "organizations",
    stage: "2",
    title: "Organizations",
    status: "done",
    summary:
      "Parallel four-pass org harvest into organization_entities, with merge, field denials, and the Organizations registry tab.",
    remaining: [
      "Same attachment gap as contacts.",
      "Merge quality still matters before any later wiki export.",
    ],
  },
  {
    id: "affiliations",
    stage: "2B",
    title: "Link contacts with organizations",
    status: "in_progress",
    summary:
      "This is the Wikipedia-like linking layer, not Open Knowledge Format. Propose / adjudicate / approve already live on Entities (person_organization_affiliations). Body rosters are complete; pending edges are not approved yet.",
    remaining: [
      "Curate pending employed-by / represents / board-of edges now, in parallel with the body to-do harvest. Do not wait for attachment harvest.",
      "Re-run Propose incrementally after attachment harvest adds people or orgs.",
      "Do not dump the phonebook into every extract prompt — keep linking at this layer.",
    ],
  },
  {
    id: "events",
    stage: "3",
    title: "Events",
    status: "done",
    summary:
      "Dedicated calendar harvest (meetings, cancels, reschedules, hard deadlines, inspections). Persist follows Google Calendar add / move / hide. Bodies only.",
    remaining: [
      "Attachment harvest not started.",
      "Dated maintenance stays free text until Stage 5 — do not invent equipment assets from events.",
    ],
  },
  {
    id: "todos",
    stage: "4",
    title: "To-dos",
    status: "in_progress",
    summary:
      "Dedicated harvest writes extracted_action_items. Global To-Dos is the working list (last 120 days open; older harvests stale). Meeting merge and manual adds share that list. Body harvest is the only incomplete Stage 1–4 pass — bulk extract has not been run.",
    remaining: [
      "Bulk-extract to-dos on email bodies first. Assignees are free text, so Stage 2B is not a blocker. This historical pass is also the first catch-up; ongoing cron should not start until it is done or the nightly job becomes a 7,000-email run.",
      "related_event_id is still a stub — AGM prep should hang off the AGM event without becoming calendar rows.",
      "Assignee text is not resolved to contact registry IDs (after 2B).",
      "Attachment harvest not started (same new wiring as contacts / orgs / events).",
    ],
  },
  {
    id: "equipment",
    stage: "5",
    title: "Equipment",
    status: "not_started",
    summary:
      "Dedicated harvest is not built. The extraction calendar equipment lane is a placeholder. Older analysis-path mentions and a building_equipment_registry import stub exist; they are not Stage 5.",
    remaining: [
      "Wait until attachment markdown is in place — prefer drawings and specs over body mentions.",
      "Resolve mentions against the registry; never create durable assets from bid options or components.",
      "Drawing-schedule ingest into the registry is spec-only (docs/02).",
    ],
  },
];

/** Work that is not a numbered harvest stage but is already specified in-repo. */
export const BUILDOUT_BACKLOG: BuildoutItem[] = [
  {
    id: "vision-backfill",
    stage: null,
    title: "Attachment vision backfill",
    status: "in_progress",
    summary:
      "Gemini page-vision on Docling PDFs. Most leftover pages failed on the monthly spend cap — this cannot finish until the cap is raised or resets. Substrate for harvest-from-markdown, not a harvest stage of its own.",
    remaining: [
      "Raise or wait out the Gemini monthly spend cap, then Retry remaining pages.",
      "Do not start attachment harvest until this is mostly done, or the same files get harvested twice.",
    ],
  },
  {
    id: "attachment-harvest",
    stage: null,
    title: "Harvest from attachment markdown",
    status: "not_started",
    summary:
      "Dedicated contact / org / event / to-do jobs still read email bodies only. Stored Docling markdown is unused by those jobs. This is new wiring, not a rerun of the body harvests, and it should include to-dos.",
    remaining: [
      "Feed stored attachment markdown into the same four harvests after vision is mostly done.",
      "After new people/orgs land, re-run Stage 2B Propose incrementally.",
      "Equipment Stage 5 should prefer drawings and specs over body mentions.",
    ],
  },
  {
    id: "ongoing-extract",
    stage: null,
    title: "Ongoing ingest + harvest",
    status: "in_progress",
    summary:
      "Gmail ingest cron (node-cron, default 07:00) and Sync now share one pipeline. Harvest-after-sync is built: missing-only contacts / orgs / events / to-dos, skipped when a bulk extract is already running. The Email settings toggle is off until the historical to-do bulk finishes.",
    remaining: [
      "Turn on Harvest after sync after the historical to-do bulk completes so the first automatic run is a small catch-up, not 7,000 emails.",
      "New PDFs still need Docling/vision; do not wait for the historical vision cap to start body harvest on new mail.",
      "DISABLE_BACKGROUND_WORKERS=true stops the ingest scheduler on local npm run dev — production must leave workers on.",
    ],
  },
  {
    id: "telegram-hitl",
    stage: null,
    title: "Telegram human oversight",
    status: "in_progress",
    summary:
      "After ingest + harvest, a Telegram digest covers decisions the model should not make alone. Low-confidence contact matches are held instead of auto-applied when TELEGRAM_BOT_TOKEN is set and at least one user has a chat ID on their profile. Affiliation propose still stays pending; only this-run needs_review is pinged. Historical Stage 2B stays in the Entities UI.",
    remaining: [
      "Calendar conflicts are not in the digest yet.",
      "Held contacts are not listed on the Entities Activity tab — Telegram and the review table are the queue.",
      "Production should set TELEGRAM_WEBHOOK_URL + TELEGRAM_WEBHOOK_SECRET instead of long-poll.",
    ],
  },
  {
    id: "okf",
    stage: null,
    title: "Open Knowledge Format",
    status: "deferred",
    summary:
      "Not started, and not the next extraction stage. OKF is an export + wiki layer on curated persistent entities (people, vendors, equipment) after identity quality here is solid. Notes: .doc/okf-integration-notes.md.",
    remaining: [
      "Finish registries, affiliations, and quote-grounded harvest first.",
      "Then an adapter: board rows → entity / occurrence / observation (ADR-003). Opaque IDs, not slugify(name).",
      "Stage B markdown only for entities. Events and to-dos stay typed DB occurrences.",
      "Ambiguity queue + fixed-point resolver only after a measured backfill residue exists.",
    ],
  },
  {
    id: "entity-profiles",
    stage: null,
    title: "Entity profile pages",
    status: "not_started",
    summary:
      "Global To-Dos highlight stored people, orgs, equipment, and dated events on hover. Only calendar event cards link through. No person / org / equipment profile route yet.",
    remaining: ["Click-through from harvest marks and to-do text to a full card."],
  },
  {
    id: "email-drafts",
    stage: null,
    title: "Email reply drafts",
    status: "not_started",
    summary:
      "PRD Phase 2.2: Gemini drafts proposed replies into Gmail Drafts for human send. Ingest, allowlist, and sync exist; draft generation does not. Constitution: draft only, never auto-send.",
    remaining: ["Draft generation + Gmail Drafts write path after extraction quality is trusted."],
  },
  {
    id: "digital-twin",
    stage: null,
    title: "3D digital twin",
    status: "not_started",
    summary:
      "Building → Asset Overview is a Three.js proof-of-concept. The lightweight twin (drawing filter → Blender GLB → nodes.json / financials.json → heatmap) is specified under /docs and has no application implementation.",
    remaining: [
      "Drawing ingestion and schedule extract (docs/02).",
      "Spatial nodes + GLB (docs/03) and temporal ledger (docs/04).",
    ],
  },
  {
    id: "concept-promote",
    stage: null,
    title: "Concept auto-promote",
    status: "not_started",
    summary:
      "Extraction Concepts can record a routing destination. Intent is saved; facts are not automatically promoted into destination tables.",
    remaining: ["Later-phase promotion once harvest destinations are stable."],
  },
];

/**
 * What to tackle next → last. Inventory cards below stay grouped by stage;
 * this list is the execution order (including blockers and parallel work).
 */
export const BUILDOUT_SEQUENCE: BuildoutSequenceStep[] = [
  {
    id: "seq-todos",
    kind: "now",
    title: "Bulk-extract to-dos on email bodies",
    detail:
      "The only incomplete Stage 1–4 harvest, and the pipeline is already built. Assignees are free text, so Stage 2B is not a blocker. This is the working-list gap you can fill this week.",
    relatedIds: ["todos"],
  },
  {
    id: "seq-affiliations",
    kind: "parallel",
    title: "Curate Stage 2B affiliations",
    detail:
      "Human approve/deny on the pending queue while the to-do job runs. Body contact and org rosters are complete. Re-propose after attachment harvest adds people or orgs — do not stall this queue on that work.",
    relatedIds: ["affiliations"],
  },
  {
    id: "seq-ongoing",
    kind: "after",
    title: "Hang harvest-missing on the existing Gmail ingest cron",
    detail:
      "Ingest then harvest-missing is built (cron and Sync now). Leave Harvest after sync off until the historical to-do bulk finishes. The first hooked run still harvests contacts/orgs/events on mail that arrived after those backfills.",
    relatedIds: ["ongoing-extract", "todos", "contacts", "organizations", "events"],
  },
  {
    id: "seq-telegram",
    kind: "after",
    title: "Telegram digest for ambiguous identity decisions",
    detail:
      "Built: after harvest, hold ambiguous contact matches and ping new affiliation needs_review. Approve/Deny in Telegram writes back. Historical 2B curation stays in the Entities UI. Set TELEGRAM_BOT_TOKEN, then save your chat ID in Profile.",
    relatedIds: ["telegram-hitl", "affiliations"],
  },
  {
    id: "seq-vision",
    kind: "blocked",
    title: "Finish attachment vision",
    detail:
      "Most leftover pages failed on Gemini's monthly spend cap. Raise or wait out the cap, then Retry remaining pages. Can run in the background once billing works.",
    relatedIds: ["vision-backfill"],
  },
  {
    id: "seq-attachment-harvest",
    kind: "after",
    title: "Harvest contacts, orgs, events, and to-dos from attachments",
    detail:
      "New wiring, not a rerun: dedicated harvests still read bodies only. Wait until vision is mostly done or you pay twice. Include to-dos. Then re-run Stage 2B Propose on new people and orgs.",
    relatedIds: ["attachment-harvest", "contacts", "organizations", "events", "todos"],
  },
  {
    id: "seq-todo-quality",
    kind: "after",
    title: "To-do quality and entity profile pages",
    detail:
      "Hang AGM-style prep off calendar events via related_event_id. Resolve assignee text to contact IDs after 2B. Wire click-through from hover cards to person / org / equipment pages.",
    relatedIds: ["todos", "entity-profiles"],
  },
  {
    id: "seq-equipment",
    kind: "later",
    title: "Equipment (Stage 5)",
    detail:
      "Not started. Prefer drawings and specs from attachment markdown over body mentions. Do not invent durable assets from bid options.",
    relatedIds: ["equipment"],
  },
  {
    id: "seq-deferred",
    kind: "later",
    title: "Email drafts, 3D twin, concept auto-promote, Open Knowledge Format",
    detail:
      "PRD Phase 2.2 drafts wait until harvest quality is trusted. Twin and concept promote are spec-only. OKF is an export + wiki layer after registries, affiliations, and equipment are solid — not the next extraction stage.",
    relatedIds: ["email-drafts", "digital-twin", "concept-promote", "okf"],
  },
];

export const BUILDOUT_STATUS_LABEL: Record<BuildoutStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  not_started: "Not started",
  deferred: "Deferred",
};

export const BUILDOUT_SEQUENCE_KIND_LABEL: Record<BuildoutSequenceKind, string> =
  {
    now: "Do now",
    parallel: "In parallel",
    blocked: "Blocked",
    after: "After that",
    later: "Later",
  };

const BUILDOUT_ITEMS_BY_ID: Map<string, BuildoutItem> = new Map(
  [...BUILDOUT_STAGES, ...BUILDOUT_BACKLOG].map((item) => [item.id, item]),
);

export function buildoutItemById(id: string): BuildoutItem | undefined {
  return BUILDOUT_ITEMS_BY_ID.get(id);
}

export function countByStatus(items: readonly BuildoutItem[]): Record<
  BuildoutStatus,
  number
> {
  const counts: Record<BuildoutStatus, number> = {
    done: 0,
    in_progress: 0,
    not_started: 0,
    deferred: 0,
  };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}
