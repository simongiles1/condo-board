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

export const BUILDOUT_REVIEWED_ON = "2026-09-04";

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
      "Run `backfill:org-mentions` if pass-3 JSON exists but mention counts are stale.",
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
      "Working-list click-in and sentence highlights shipped (display-time clip, amber on the extracting sentence). Meeting-sourced rows still have no detail panel.",
      "related_event_id is still a stub — AGM prep should hang off the AGM event without becoming calendar rows.",
      "Assignee text is not resolved to contact registry IDs (after 2B).",
      "QA auto-close: a later ping in the thread can mark an ask Done when the work was not actually delivered (close-out wiring fixed 2026-08; spot-check edge cases).",
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
      "Named building jobs are first-class with four-pass body harvest, fingerprint registry, human merge, and mention staging (`project_mentions`). Entities → Projects has a Mentions tab, AI identity review (Duplicates), board-report salience, filters, pagination, and phase/year badges. Identity is name plus year when present — 2024 and 2026 jobs stay separate until you merge them. Bulk extract and roster curation continue in parallel; not on harvest-after-sync until a bulk you trust finishes.",
    remaining: [
      "Bulk-extract projects on email bodies (inbox Extract Projects or bulk extract). Run `backfill:project-mentions` if pass-3 JSON exists but Mentions is empty.",
      "Merge duplicate mentions and AI-proposed groups on Entities → Projects as they land. Do not auto-merge by name alone.",
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
    status: "in_progress",
    summary:
      "Click-through to a shared letterhead side panel is live on harvest marks, Global To-Dos mentions, and registry names (Contacts / Organizations / Projects / Equipment). Hover stays preview-only. Unique fingerprint → registry resolve on harvest clicks; ambiguous mentions stay unlinked. Organization mentions and per-alias counts ship on the Organizations registry.",
    remaining: [
      "Side panel still lacks “what projects is this org on” / “what is this person CEO of” (affiliations parked).",
      "Hang AGM-style to-dos off calendar events via related_event_id.",
      "Christmas-tree control: layer toggles (contacts / orgs / events / to-dos / projects), fade non-theme layers, keep the page’s current entity full-chroma.",
      "Calendar / source-panel highlights besides inbox harvest and Global To-Dos.",
    ],
  },
  {
    id: "who-is-who",
    stage: null,
    title: "Who's-who involvement cards",
    status: "in_progress",
    summary:
      "Person profile letterhead (initials, name, title, phone, email) plus a role-based “get me involved when” prompt from the job title (live on entity profile click-through). Not history-seeded yet.",
    remaining: [
      "Replace the job-title heuristic with a mini-prompt from that person’s email history.",
      "Photos on the letterhead.",
      "Feed those prompts into to-do suggestions and email drafts.",
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
      "The working list is a filterable harvest inbox, not a management tool. Email-harvest click-in is live (row → source email + sentence highlight; Mark complete stays on the row). Meeting-sourced rows still have no detail panel. Build remaining primitives on Working (last 120 days), not Archive.",
    remaining: [
      "Meeting-sourced rows: click-in detail panel (v2 meeting merge rows included).",
      "Dependencies, blockers, subtasks, comments, artifacts, assignees, due dates, categories.",
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
    id: "floor-plan-markup",
    stage: null,
    title: "Floor plan markup & mechanical risers",
    status: "in_progress",
    summary:
      "Building → Floor plans: upload, crop, per-building pin, compare, and full-screen edit. Architectural and mechanical families; east/west mechanical merge. Edit mode has lines, rectangles, rooms, callouts, riser connections, follow-a-stack-up-the-building, standardize templates, and overlay lines from other floors. Mechanical riser catalog persists type/number assignments.",
    remaining: [
      "Finish tracing riser stacks floor-by-floor (follow overlays, approve/dismiss, mark completed).",
      "Standardize freehand boxes to template shapes building-wide; verify clip-draw dialog at plan scale.",
      "Room/unit enclosures and leak glow for gap QA on dense sheets.",
      "Drawing schedule extract into equipment registry (docs/02) — not started; markup is the manual path for now.",
    ],
  },
  {
    id: "digital-twin",
    stage: null,
    title: "3D digital twin",
    status: "in_progress",
    summary:
      "Building → Asset overview & 3D: real massing from pinned floor plans (slabs, extruded walls, blueprint textures on slab tops). Phase 2–3 ship 3D riser pipe sweeps, system layer filters, opacity sliders, floor slicing, click-to-inspect, quick presets, and unit search with selective wall transparency. The docs/ lightweight twin (Blender GLB → nodes.json / financials.json → cost heatmap) is spec-only.",
    remaining: [
      "Verify presets, wall-opacity cavity views, pipe inspection card, and unit highlight on production data.",
      "Equipment nodes bound to 3D picks (docs/03 nodes.json) — not wired.",
      "Temporal ledger + heatmap from email parse (docs/04 financials.json) — not wired.",
      "Drawing schedule auto-extract (docs/02) instead of hand-traced riser markup.",
    ],
  },
  {
    id: "meeting-review-v2",
    stage: null,
    title: "Board meeting review (v2 pipeline)",
    status: "in_progress",
    summary:
      "Operations → Meetings v2: upload board package PDF + transcript, Inngest pipeline (ingest → agenda extract → evidence → per-item investigation → validation → minutes draft). Review workspace at /operations/meetings/v2/[id]. Coexists with v1 generate flow; not yet the default board-meeting checklist.",
    remaining: [
      "End-to-end QA on a real monthly package (agenda alignment, evidence cites, draft quality).",
      "Wire reviewed items into Global To-Dos and project ops (related_project_id, meeting mode).",
      "Replace or retire v1 generate once v2 draft quality is trusted.",
      "Resolution / motion tracking still belongs under governance, not this pipeline alone.",
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
    id: "seq-floor-plans",
    kind: "parallel",
    title: "Trace mechanical risers on floor plans",
    detail:
      "Building → Floor plans: crop/pin/compare is live. Keep following stacks floor-by-floor (approve, dismiss, completed). Standardize freehand boxes to catalog templates. Rooms and leak glow help close wall gaps before 3D trusts the geometry.",
    relatedIds: ["floor-plan-markup", "digital-twin"],
  },
  {
    id: "seq-3d-twin",
    kind: "parallel",
    title: "3D twin: verify massing, pipes, and unit highlight",
    detail:
      "Asset overview & 3D has real slabs/walls, blueprint textures, riser sweeps, layer presets, opacity sliders, floor slice, and unit search with wall transparency. Spot-check on production markup. nodes.json / financials.json heatmap remains spec-only (docs/).",
    relatedIds: ["digital-twin", "floor-plan-markup"],
  },
  {
    id: "seq-projects",
    kind: "parallel",
    title: "Project extract + mentions + identity merge (ongoing lab)",
    detail:
      "Mentions tab, AI Duplicates review, and board-report salience are live. Keep bulk extract and merge over the next month. Maglock 2024 and Maglock 2026 stay separate until you merge them. Leave harvest-after-sync alone until a bulk you trust finishes.",
    relatedIds: ["projects"],
  },
  {
    id: "seq-meetings-v2",
    kind: "parallel",
    title: "Meetings v2 pipeline on a real package",
    detail:
      "Upload PDF + transcript, let Inngest run ingest → agenda → evidence → investigate → validate → draft. QA review workspace output before making it the default meeting flow. Later: hang open items off projects and Global To-Dos.",
    relatedIds: ["meeting-review-v2", "project-ops", "todos"],
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
    title: "Entity profiles: layer toggles and event links",
    detail:
      "Click-through letterhead is live on harvest, Global To-Dos, and registries. Who's-who uses job-title heuristics. Remaining: Christmas-tree layer toggles, related_event_id for AGM prep, history-seeded prompts, photos, affiliations context.",
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
      "Nice-to-have vs the board checklist. Needs drawings from management, then attachment markdown. Hand-traced riser markup on floor plans is the interim spatial path. Do not invent durable assets from bid options.",
    relatedIds: ["equipment", "floor-plan-markup", "digital-twin"],
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
    title: "Email drafts, nodes/financials heatmap, concept auto-promote, Open Knowledge Format",
    detail:
      "Drafts wait until source-quote quality is trusted and who's-who prompts exist. Cost heatmap rides on nodes.json + financials.json (docs/) after equipment registry quality is solid. OKF is an export + wiki layer after registries, affiliations, and equipment — not the next extraction stage.",
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

/** Column order for the build-out Gantt (execution phase bands). */
export const BUILDOUT_GANTT_PHASE_ORDER: readonly BuildoutSequenceKind[] = [
  "now",
  "parallel",
  "blocked",
  "after",
  "later",
  "deferred",
] as const;

export type BuildoutGanttRowKind = "playbook" | "stage" | "backlog";

export type BuildoutGanttRow = {
  id: string;
  rowKind: BuildoutGanttRowKind;
  label: string;
  subtitle: string | null;
  /** Item status; omitted for playbook rows. */
  status: BuildoutStatus | null;
  /** Phase columns where this row should render a bar. */
  phases: BuildoutSequenceKind[];
  /** Playbook step order (1-based) when `rowKind` is `playbook`. */
  sequenceOrder: number | null;
  summary: string;
  remaining: string[];
};

function phasesForItem(itemId: string): BuildoutSequenceKind[] {
  const phases = new Set<BuildoutSequenceKind>();
  for (const step of BUILDOUT_SEQUENCE) {
    if (step.relatedIds.includes(itemId)) {
      phases.add(step.kind);
    }
  }
  return BUILDOUT_GANTT_PHASE_ORDER.filter((phase) => phases.has(phase));
}

function compareStageLabel(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const parse = (value: string) => {
    const match = /^(\d+)([A-Za-z]?)$/.exec(value.trim());
    if (!match) return { num: Number.MAX_SAFE_INTEGER, suffix: value };
    return { num: Number(match[1]), suffix: match[2] ?? "" };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.num !== right.num) return left.num - right.num;
  return left.suffix.localeCompare(right.suffix);
}

export function buildoutGanttRows(): {
  playbook: BuildoutGanttRow[];
  stages: BuildoutGanttRow[];
  backlog: BuildoutGanttRow[];
} {
  const playbook: BuildoutGanttRow[] = BUILDOUT_SEQUENCE.map((step, index) => ({
    id: step.id,
    rowKind: "playbook",
    label: step.title,
    subtitle: BUILDOUT_SEQUENCE_KIND_LABEL[step.kind],
    status: null,
    phases: [step.kind],
    sequenceOrder: index + 1,
    summary: step.detail,
    remaining: step.relatedIds.map((relatedId) => relatedItemLabel(relatedId)),
  }));

  const stages: BuildoutGanttRow[] = [...BUILDOUT_STAGES]
    .sort((left, right) => compareStageLabel(left.stage, right.stage))
    .map((item) => ({
      id: item.id,
      rowKind: "stage",
      label: item.title,
      subtitle: item.stage ? `Stage ${item.stage}` : null,
      status: item.status,
      phases: phasesForItem(item.id),
      sequenceOrder: null,
      summary: item.summary,
      remaining: item.remaining,
    }));

  const backlog: BuildoutGanttRow[] = BUILDOUT_BACKLOG.map((item) => ({
    id: item.id,
    rowKind: "backlog",
    label: item.title,
    subtitle: null,
    status: item.status,
    phases: phasesForItem(item.id),
    sequenceOrder: null,
    summary: item.summary,
    remaining: item.remaining,
  }));

  return { playbook, stages, backlog };
}

function relatedItemLabel(id: string): string {
  const item = BUILDOUT_ITEMS_BY_ID.get(id);
  if (!item) return id;
  return item.stage ? `Stage ${item.stage} · ${item.title}` : item.title;
}
