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
  | "later"
  | "deferred";

export type BuildoutSequenceStep = {
  id: string;
  kind: BuildoutSequenceKind;
  title: string;
  detail: string;
  /** Matching `BuildoutItem.id` values so the playbook points at the cards below. */
  relatedIds: string[];
};

export const BUILDOUT_REVIEWED_ON = "2026-08-17";

/**
 * Corpus snapshot for the playbook header. Not queried live — refresh when
 * reviewing this file. Exact coverage belongs on the extraction calendar.
 */
export const BUILDOUT_COVERAGE_SNAPSHOT = {
  asOf: "2026-08-17",
  emails: 7311,
  contactsExtracted: 7311,
  orgsExtracted: 7311,
  eventsExtracted: 7311,
  todosExtracted: 7311,
  projectsExtracted: 0,
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
      "Lifetime mention counts are a cleanup sort (get 90% of the roster clean), not the product ranking. Default view and AI assignment weight should be recency / trend so a new project manager outranks a historically-mentioned person who is fading.",
      "Merge duplicates and zero-mention stubs (e.g. “admin”) as they show up.",
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
    status: "deferred",
    summary:
      "Propose / adjudicate / approve already live on Entities. Body rosters are complete; 266 pending edges are not approved yet. Parked until another board member can help curate — not a blocker for profiles, drip, or later harvests.",
    remaining: [
      "Resume when a second reviewer is available: approve / deny employed-by / represents / board-of edges in the Entities UI.",
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
      "Dated maintenance stays free text until Stage 6 — do not invent equipment assets from events.",
      "To-do ↔ event linking is still a stub — AGM prep should hang off the AGM calendar event.",
    ],
  },
  {
    id: "todos",
    stage: "4",
    title: "To-dos",
    status: "done",
    summary:
      "Dedicated harvest writes extracted_action_items. Body bulk finished (7,331 emails, then drip catch-up). Global To-Dos is the working list (last 120 days open; Archive for older). Meeting merge and manual adds share that list.",
    remaining: [
      "Source-quote highlight must land on the extracting sentence, not the whole email. No yellow = you cannot tell if the task is real. Fix that before any summary-first (NotebookLM) reading UX.",
      "Rows are not clickable into a task — filter / view email / mark complete only. Detail workspace is a later card.",
      "related_event_id is still a stub — AGM prep should hang off the AGM event without becoming calendar rows.",
      "Assignee text is not resolved to contact registry IDs (after 2B).",
      "QA auto-close: a later ping in the thread can mark an ask Done when the work was not actually delivered.",
      "Attachment harvest not started (same new wiring as contacts / orgs / events / projects).",
      "120-day Working vs Archive split is intentional. Historical harvests exist for rare recurring obligations (reserve fund study). Do not invest full task-management UX on Archive first.",
    ],
  },
  {
    id: "projects",
    stage: "5",
    title: "Projects",
    status: "in_progress",
    summary:
      "Named building jobs (maglock, EV chargers, envelope work) are a first-class entity with a four-pass body harvest, fingerprint registry, and human merge. Identity is name plus year when present — 2024 and 2026 jobs stay separate until you merge them. Pipeline is built; the corpus pass has not been run. Not added to harvest-after-sync until that bulk finishes.",
    remaining: [
      "Bulk-extract projects on email bodies (inbox Extract Projects or bulk extract).",
      "Merge duplicate mentions on Entities → Projects as they land. Do not auto-merge by name alone.",
      "Turn on drip for projects only after the historical bulk, or the nightly job becomes a 7,000-email run.",
      "Attachment harvest not started. related_project_id on to-dos is not wired yet.",
      "After the roster exists: nest tasks under projects (see Project operations). Board meetings review projects, not a 50-item task dump.",
    ],
  },
  {
    id: "equipment",
    stage: "6",
    title: "Equipment",
    status: "not_started",
    summary:
      "Dedicated harvest is not built. The extraction calendar equipment lane is a placeholder. Older analysis-path mentions and a building_equipment_registry import stub exist; they are not Stage 6.",
    remaining: [
      "Wait until attachment markdown is in place — prefer drawings and specs over body mentions.",
      "Resolve mentions against the registry; never create durable assets from bid options or components.",
      "Drawing-schedule ingest into the registry is spec-only (docs/02). Needs drawings from management before extracted mentions can tag real assets.",
      "Separate value proposition from the board checklist. Keep this after to-dos, projects, and meeting review — weeks of work, nice-to-have vs must-have.",
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
      "Dedicated contact / org / event / to-do / project jobs still read email bodies only. Stored Docling markdown is unused by those jobs. This is new wiring, not a rerun of the body harvests.",
    remaining: [
      "Feed stored attachment markdown into the same harvests after vision is mostly done. Include projects.",
      "After new people/orgs land, re-run Stage 2B Propose incrementally.",
      "Equipment Stage 6 should prefer drawings and specs over body mentions.",
    ],
  },
  {
    id: "ongoing-extract",
    stage: null,
    title: "Ongoing ingest + harvest",
    status: "done",
    summary:
      "Gmail ingest cron and Sync now share one pipeline. Harvest after sync is on: missing-only contacts / orgs / events / to-dos, skipped when a bulk extract is already running. Projects are not on the drip until the historical project bulk finishes.",
    remaining: [
      "Leave Harvest after sync on in production so new allowlisted mail is harvested automatically (contacts / orgs / events / to-dos).",
      "Add projects to the drip only after the historical project bulk.",
      "New PDFs still need Docling/vision; do not wait for the historical vision cap to start body harvest on new mail.",
      "DISABLE_BACKGROUND_WORKERS=true stops the ingest scheduler and Telegram long-poll on local npm run dev — production must leave workers on.",
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
      "Production should set TELEGRAM_WEBHOOK_URL + TELEGRAM_WEBHOOK_SECRET instead of long-poll so a local full-stack run cannot steal getUpdates. Save your chat ID in Profile on live.",
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
    title: "Wikipedia graph + entity profiles",
    status: "not_started",
    summary:
      "Hover marks already show people, orgs, equipment, and dated events. Only calendar event cards link through. Goal is Wikipedia-on-steroids: every mention is visually marked, clickable, and opens a side panel of associated emails, projects, and roles. Wait until the project harvest has a roster worth opening.",
    remaining: [
      "Click a harvest mark or to-do mention → person / org / project / equipment card, not just a hover.",
      "Side panel: all emails for that entity, plus “what projects is this org on” / “what is this person CEO of”.",
      "Hang AGM-style to-dos off calendar events via related_event_id (same slice).",
    ],
  },
  {
    id: "who-is-who",
    stage: null,
    title: "Who's-who involvement cards",
    status: "not_started",
    summary:
      "From the 2026-08-17 review: each important contact gets a letterhead-style card (photo, name, title, phone) plus a short “get me involved when” prompt. History should seed those prompts (when people reached out to Paul / Bonnie about what). Used as context for to-do assignment, suggestions, and later email drafts — not a dump of every mention.",
    remaining: [
      "Generate a mini-prompt per high-mention / high-trend contact from email history.",
      "Surface on the profile: when to involve them, with one-line examples (complaint filed, contract change, etc.).",
      "Feed those prompts into to-do suggestions and email drafts. Do not wait for Stage 2B to start the card itself.",
    ],
  },
  {
    id: "project-ops",
    stage: null,
    title: "Project operations",
    status: "not_started",
    summary:
      "Harvest gives a roster. Board meetings review projects one-by-one, not a 50-item task list. Need a project lens on the same to-dos: nest tasks under a job, keep a flat list with a project chip, and open a project mid-meeting to see which assigned tasks were not mentioned.",
    remaining: [
      "Wire related_project_id so extracted and meeting to-dos hang off a project.",
      "Project view (tasks tucked under the job) and all-tasks view (project as a chip / tag). One-offs stay untagged.",
      "Board-meeting mode: click the project under discussion; only its open tasks show.",
      "Project-based costing later — spend per job, once invoices / quotes can attach.",
    ],
  },
  {
    id: "todo-workspace",
    stage: null,
    title: "To-do workspace",
    status: "not_started",
    summary:
      "The working list is a filterable harvest inbox, not a management tool. ClickUp is overkill as a product to copy, but the missing primitives are known: click-in detail, dependencies / blockers, subtasks, comments, artifacts, assignments, due dates, categories, and reminders. Build these on Working (last 120 days), not Archive.",
    remaining: [
      "Click a row → detail panel (description, source email with sentence highlight, comments, attachments).",
      "Dependencies, blockers, subtasks, assignees, due dates, categories.",
      "Comment timeline (who said what, when) and multiple reminders / notifications.",
      "Filters that already matter for the board: mine vs all, board vs management. Steal UX from existing task products; do not clone ClickUp.",
    ],
  },
  {
    id: "governance",
    stage: null,
    title: "Policies, resolutions, and announcements",
    status: "not_started",
    summary:
      "Meetings vote on resolutions; the corporation also has bylaws plus board-built policy and SOPs on top. Owner-facing search / ask-AI against that corpus is valuable on its own. Separate from the 3D twin and from BuildingLink-style bookings.",
    remaining: [
      "Track resolutions / motions from monthly meetings (carried, deferred, who moved / seconded).",
      "Ingest bylaws, house rules, and operating manuals. Split owner-facing vs employee-facing (how to turn on the rooftop lights, fire procedure).",
      "Owner search or ask-AI against policy. Announcements to residents as a later surface.",
    ],
  },
  {
    id: "resident-ops",
    stage: null,
    title: "Resident operations (BuildingLink-adjacent)",
    status: "deferred",
    summary:
      "Parking / visitor passes, unit directory, disruptions, elevator and guest-suite booking, access blacklists. Ali wanted a mid-October AGM show-and-tell even if incomplete. Paul is not convinced: BuildingLink already covers bookings, the AGM pitch is condo-fee savings not amenity UX, and management interlocks are unknown. Parked — revisit only if a separate session shows it is doable without leaving the board-ops lane.",
    remaining: [
      "Do not start until board to-dos, projects, and meeting review are useful.",
      "If revisited: unit directory (owner, contacts, file comments), upcoming disruptions, then bookings. Auth / scoping is the hard part — many users, must work flawlessly.",
      "AGM is mid-October 2026 (~15 of 333 owners). Fee savings remains the pitch; bookings are not the closer.",
    ],
  },
  {
    id: "email-drafts",
    stage: null,
    title: "Email reply drafts",
    status: "not_started",
    summary:
      "PRD Phase 2.2: Gemini drafts proposed replies into Gmail Drafts for human send. Ingest, allowlist, and sync exist; draft generation does not. Constitution: draft only, never auto-send. Who's-who prompts should be in the draft context once those cards exist.",
    remaining: [
      "Draft generation + Gmail Drafts write path after extraction quality is trusted.",
      "Include the involved contacts’ “get me involved when” prompts in draft context.",
      "After source-quote highlights are reliable, reading UX can go summary-first (NotebookLM-style) and hide the body until you need to verify.",
    ],
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
    id: "seq-projects",
    kind: "now",
    title: "Bulk-extract projects on email bodies",
    detail:
      "Pipeline is built (four-pass harvest, Entities → Projects, merge). Run the corpus pass the same way as contacts/orgs. Maglock 2024 and Maglock 2026 stay separate until you merge them. Leave harvest-after-sync alone until this bulk finishes.",
    relatedIds: ["projects"],
  },
  {
    id: "seq-project-merge",
    kind: "parallel",
    title: "Merge duplicate project mentions",
    detail:
      "As cards land, fold obvious duplicates on Entities → Projects. Same name + different years stay split on purpose. Skip 2B — linking people/orgs onto projects can wait.",
    relatedIds: ["projects"],
  },
  {
    id: "seq-todo-highlight",
    kind: "parallel",
    title: "Fix to-do source-quote highlights",
    detail:
      "Demo showed the whole email highlighted and no yellow on the extracting sentence. That is the trust gate: you cannot tell a real task from a hallucination until the quote is visible. Do this on existing harvests; do not wait for a new extract. Summary-first (NotebookLM) reading UX comes after this is reliable.",
    relatedIds: ["todos"],
  },
  {
    id: "seq-project-drip",
    kind: "after",
    title: "Add projects to harvest-after-sync",
    detail:
      "Only after the historical project bulk. Then new mail picks up project mentions automatically with contacts / orgs / events / to-dos.",
    relatedIds: ["projects", "ongoing-extract"],
  },
  {
    id: "seq-wiki-graph",
    kind: "after",
    title: "Wikipedia click-through and who's-who cards",
    detail:
      "Hover already marks entities. Next is click → profile + side panel of associated emails and projects. On the same slice: involvement prompts for the people who actually matter (history-seeded “get me involved when”), and switch the default Entities sort / AI weight from lifetime mentions to trend.",
    relatedIds: ["entity-profiles", "who-is-who", "contacts"],
  },
  {
    id: "seq-project-ops",
    kind: "after",
    title: "Hang to-dos off events and projects",
    detail:
      "AGM prep → related_event_id. Building-improvement work → related_project_id. Then a project view for board meetings: open the job under discussion and see which assigned tasks were not mentioned. Flat list keeps a project chip; one-offs stay untagged. Costing per project is later.",
    relatedIds: ["project-ops", "todos", "events", "projects"],
  },
  {
    id: "seq-telegram-ops",
    kind: "after",
    title: "Telegram webhook on production",
    detail:
      "HITL code is shipped. On live: TELEGRAM_WEBHOOK_URL + TELEGRAM_WEBHOOK_SECRET instead of long-poll, then save your chat ID in Profile. Calendar conflicts and an Activity-tab queue can wait. Historical 2B still stays in the Entities UI.",
    relatedIds: ["telegram-hitl"],
  },
  {
    id: "seq-affiliations",
    kind: "deferred",
    title: "Stage 2B affiliations (parked)",
    detail:
      "Needs another board member. 266 pending edges, 0 approved. The propose/approve UI is already live — do not stall projects, drip, or attachment work on this queue.",
    relatedIds: ["affiliations"],
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
    title: "Harvest contacts, orgs, events, to-dos, and projects from attachments",
    detail:
      "New wiring, not a rerun: dedicated harvests still read bodies only. Wait until vision is mostly done or you pay twice. Then re-run Stage 2B Propose on new people and orgs.",
    relatedIds: ["attachment-harvest", "contacts", "organizations", "events", "todos", "projects"],
  },
  {
    id: "seq-todo-workspace",
    kind: "later",
    title: "To-do workspace (Working list only)",
    detail:
      "Click-in detail, dependencies, blockers, subtasks, comments, artifacts, assignments, due dates, categories, reminders. Steal UX from existing task products; do not clone ClickUp. Archive stays a historical dump.",
    relatedIds: ["todo-workspace", "todos"],
  },
  {
    id: "seq-equipment",
    kind: "later",
    title: "Equipment (Stage 6)",
    detail:
      "Nice-to-have vs the board checklist. Needs drawings from management, then attachment markdown. Do not invent durable assets from bid options.",
    relatedIds: ["equipment", "digital-twin"],
  },
  {
    id: "seq-governance",
    kind: "later",
    title: "Policies, resolutions, and owner-facing SOPs",
    detail:
      "Track meeting votes. Ingest bylaws plus board-built policy and employee/owner manuals. Owner search / ask-AI against that corpus is the value. Announcements after that.",
    relatedIds: ["governance"],
  },
  {
    id: "seq-resident-ops",
    kind: "deferred",
    title: "Resident operations (parked)",
    detail:
      "Bookings, passes, unit directory, disruptions. Ali wanted an AGM show-and-tell (mid-October). Paul is holding: BuildingLink already does bookings, the AGM pitch is fee savings, and management interlocks are unknown. Revisit only in a separate session if it stays in-lane.",
    relatedIds: ["resident-ops"],
  },
  {
    id: "seq-deferred",
    kind: "later",
    title: "Email drafts, 3D twin, concept auto-promote, Open Knowledge Format",
    detail:
      "Drafts wait until source-quote quality is trusted and who's-who prompts exist. Twin rides on equipment + drawings. OKF is an export + wiki layer after registries, affiliations, and equipment are solid — not the next extraction stage.",
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
    deferred: "Parked",
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
