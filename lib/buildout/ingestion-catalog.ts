/**
 * Curated entity-ingestion reference for the build-out modal (not live DB counts).
 */

import { buildProjectHighlightDomainContext } from "@/lib/email-analysis/project-highlight-shared";
import type { BuildoutStatus } from "@/lib/buildout/progress";
import { BUILDOUT_STAGES } from "@/lib/buildout/progress";

/** How completely a source feeds the entity registry (vs search-only). */
export type IngestionCoverageLevel =
  | "full"
  | "partial"
  | "legacy"
  | "search_only"
  | "none";

export type IngestionCatalogRow = {
  id: string;
  title: string;
  buildoutStatus: BuildoutStatus | null;
  emailBody: { level: IngestionCoverageLevel; short: string };
  attachments: { level: IngestionCoverageLevel; short: string };
  harvestPasses: string;
  registry: string;
  detailMarkdown: string;
};

const COVERAGE_LABEL: Record<IngestionCoverageLevel, string> = {
  full: "Full",
  partial: "Partial",
  legacy: "Legacy only",
  search_only: "Search only",
  none: "None",
};

export function ingestionCoverageLabel(level: IngestionCoverageLevel): string {
  return COVERAGE_LABEL[level];
}

function stageStatus(id: string): BuildoutStatus | null {
  return BUILDOUT_STAGES.find((s) => s.id === id)?.status ?? null;
}

function projectsDetailMarkdown(): string {
  const domain = buildProjectHighlightDomainContext();
  return `## What counts as a project

${domain}

## Harvest passes (email body)

Projects use the same four-pass thread harvest as contacts and organizations:

1. **Pass 1** — Highlight pass: find project names, years, phases, contractors, and locations in each message’s **unique authored body** excerpt.
2. **Pass 2** — Second highlight pass: recover fields the model missed in pass 1 (same excerpt).
3. **Pass 3** — Fingerprint pass: one **entity card per distinct project per email** (work-name required; headers + full message body as context).
4. **Pass 4** — Thread merge: collapse duplicate cards across the thread and apply the **minting gate** below. Minted cards sync to \`project_entities\` and \`project_mentions\`.

Events and to-dos only run **pass 1** on the body. Equipment does not use this highlight pipeline.

## Minting gate (what becomes a registry project)

A card is **dropped** (not minted) when:

- **Name** is missing, or is a company/person, or matches / shortens the contractor name.
- The **thread-level boundary test** fails:
  1. **Multi-step** — more than a single inbox ping, or a contractor engaged for a body of work.
  2. **Non-routine** — not a one-off missed appointment, not a complaint with no named job, not day-to-day work (bulbs, chute, re-key), and not standing monthly maintenance with no separate campaign (landscaping, hot tub, monthly HVAC, elevators).
  3. **Discrete lifecycle** — identifiable start/active/completion, including a minor project (named annual or seasonal campaign, or elevated cost or technicality even if site work is a day or two) and remediation.
- The work exists only to facilitate a named parent job (unit-access escort, temporary protection, a permit run). Leave it as a task on that job.

**Keep:** capital jobs, multi-unit floods/restoration, cleaning campaigns and other minor projects, reserve studies, design/tender work. A break from a standing contract (replace trees or sprinklers, a one-off heat-pump repair, annual window cleaning) can still be a project.

**Drop:** vendor names as projects, standing monthly maintenance with no campaign, day-to-day tasks, facilitating logistics for a parent job, complaints with no named job, missed service calls, contractor-only stubs.

Code also enforces \`cardPassesNameMintingGate\`: work-name must not collide with contractor or organization identities.

## Identity after minting

- **Anchor gating** — mention resolution prefers a physical anchor (equipment, area, or service category) so different assets do not share one alias bag.
- **Tiers** — service calls/incidents can **promote** to capital projects in place (multiple quotes, board package, or >30 days).
- **Scope** — \`building\` / \`multi_unit\` / \`unit\` / \`unknown\`, from the model or inferred from location text.

## Email body vs attachments

| Source | Projects |
| --- | --- |
| **Email body** | Four-pass harvest → registry (bulk extract / Re-harvest C+P). Historical bulk completed 2026-09-24 (~7,374 emails). Enable **Projects** under **Email & Sync Settings → Sync controls → Harvest entity types** for post-sync drip on new mail. |
| **Attachments** | Not mined into \`project_entities\`. Board packages are handled in **Meetings V2**; attachment markdown is indexed for **Ask the archive**, not entity minting. |

## Still open

- Turn on **Projects** in Email & Sync Settings harvest checkboxes; then curate the roster (merge + AI Duplicates on Entities → Projects).
- Pass-4 re-extract only when you intentionally want to revisit older “routine” mis-mints — not required after bulk.
- **Harvest from attachment markdown** (shared backlog with contacts/orgs/events/todos).
`;
}

function harvestPassesDetailMarkdown(): string {
  return `## Why “pass 1” through “pass 4”?

Bulk **highlight harvest** (inbox Extract, Re-harvest thread, bulk extract) runs in ordered passes per thread. All passes read the **unique authored email body** (\`body_text_unique\`), not attachment files.

### Pass 1 — First highlight pass

Scan the highlighted unique excerpt for typed fields (names, dates, org names, project fields, etc.). Stored per email per model.

### Pass 2 — Second highlight pass (contacts, orgs, projects only)

Same excerpt, but the model may only return values **missed** in pass 1. Reduces false negatives without re-asking for everything.

### Pass 3 — Fingerprint pass (contacts, orgs, projects only)

Uses pass 1+2 fields plus **email headers and full message body** to emit **entity cards** (sparse stubs allowed). This is the per-email identity snapshot before thread merge.

### Pass 4 — Thread merge (contacts, orgs, projects only)

Merges pass-3 cards across all messages in the thread into one set per model. Applies domain rules (e.g. project **minting gate**). Contacts then queue **registry ingest**; projects/orgs sync fingerprints to registries and mentions.

### Who runs which passes?

| Entity | Passes |
| --- | --- |
| Contacts | 1 → 2 → 3 → 4 (+ registry ingest) |
| Organizations | 1 → 2 → 3 → 4 |
| Projects | 1 → 2 → 3 → 4 |
| Events / notable dates | **1 only** (then calendar persist) |
| To-dos | **1 only** (then \`extracted_action_items\`) |
| Equipment | **No highlight passes** — canonical register + mention resolution from legacy extracts and project anchors |

### Not the same as legacy “analyze email”

The older **email analysis worker** still runs **body + each attachment** through a single multi-domain Gemini schema (\`extraction_sources\`). That path feeds equipment mentions, budgets, invoices, and calendar-adjacent rows on attachments, but it is **not** what builds the contact/org/project registries today.

### Attachments today

- **Docling / vision** → markdown stored on attachments.
- **File cards + \`document_chunks\`** → semantic search (Ask the archive).
- **Dedicated entity harvest from attachment markdown** → backlog (\`attachment-harvest\` in build-out); bodies were finished first.
`;
}

/**
 * Rows for the build-out modal ingestion table (order matters).
 */
export function buildIngestionCatalogRows(): IngestionCatalogRow[] {
  return [
    {
      id: "harvest-passes",
      title: "How harvest passes work",
      buildoutStatus: null,
      emailBody: { level: "full", short: "All highlight passes" },
      attachments: { level: "none", short: "Not used by passes" },
      harvestPasses: "Overview (passes 1–4)",
      registry: "—",
      detailMarkdown: harvestPassesDetailMarkdown(),
    },
    {
      id: "contacts",
      title: "Contacts",
      buildoutStatus: stageStatus("contacts"),
      emailBody: {
        level: "full",
        short: "Passes 1–4 + headers in pass 3",
      },
      attachments: {
        level: "search_only",
        short: "Markdown → RAG only",
      },
      harvestPasses: "1 → 2 → 3 → 4",
      registry: "`contact_persons` + mentions",
      detailMarkdown: `## Contacts

### Email body — **full**

- Passes **1–4** on unique authored body text; pass 3 also uses From/To/Cc/Subject.
- Pass 4 merges the thread and ingests into \`contact_persons\` (registry queue).
- Included in **post-sync harvest** (contacts, orgs, events, todos).

### Attachments — **search only**

- Docling/vision markdown is chunked for **Ask the archive**, not highlight harvest.
- Legacy per-attachment Gemini analysis may still extract people into old tables if you run analyze APIs; registries are driven by highlight harvest.

### Gaps

${BUILDOUT_STAGES.find((s) => s.id === "contacts")?.remaining.map((l) => `- ${l}`).join("\n") ?? ""}
`,
    },
    {
      id: "organizations",
      title: "Organizations",
      buildoutStatus: stageStatus("organizations"),
      emailBody: {
        level: "full",
        short: "Passes 1–4 (body)",
      },
      attachments: {
        level: "search_only",
        short: "Markdown → RAG only",
      },
      harvestPasses: "1 → 2 → 3 → 4",
      registry: "`organization_entities` + mentions",
      detailMarkdown: `## Organizations

### Email body — **full**

- Same four-pass pattern as contacts into \`organization_entities\`.
- Post-sync harvest includes organizations.

### Attachments — **search only**

- Same attachment gap as contacts until **harvest from attachment markdown** ships.

### Gaps

${BUILDOUT_STAGES.find((s) => s.id === "organizations")?.remaining.map((l) => `- ${l}`).join("\n") ?? ""}
`,
    },
    {
      id: "equipment",
      title: "Equipment",
      buildoutStatus: stageStatus("equipment"),
      emailBody: {
        level: "partial",
        short: "Legacy body extract + project equipment_mentions",
      },
      attachments: {
        level: "legacy",
        short: "Legacy analyze per file; harvest worker mostly body",
      },
      harvestPasses: "None (register + resolve)",
      registry: "`building_equipment_registry` + `equipment_mentions`",
      detailMarkdown: `## Equipment

### Email body — **partial**

- **Canonical register** is curated (\`building_equipment_registry\`) — resolve-only, no mint from loose mentions.
- Legacy **email analysis** on the message body can emit \`equipment_mentions\` in \`extraction_sources\`.
- **Project pass 3** may list \`equipment_mentions\` text; Pass A resolves anchors onto project mentions.

### Attachments — **legacy only**

- Legacy **analyze email** runs Gemini per attachment into \`extraction_sources\` (\`email_attachment\`).
- Dedicated \`harvestEquipmentMentions\` today scans **email_message** sources (and project mention anchors), not attachment rows — attachment equipment may sit in JSON until that gap is closed.
- Drawing schedules (docs/02) are the intended long-term source for major assets.

### Search

- Attachment markdown is searchable via corpus index; it does not automatically update the equipment register.

### Gaps

${BUILDOUT_STAGES.find((s) => s.id === "equipment")?.remaining.map((l) => `- ${l}`).join("\n") ?? ""}
`,
    },
    {
      id: "events",
      title: "Events / notable dates",
      buildoutStatus: stageStatus("events"),
      emailBody: {
        level: "full",
        short: "Pass 1 highlight → calendar",
      },
      attachments: {
        level: "legacy",
        short: "Legacy analyze may extract dates",
      },
      harvestPasses: "1 only",
      registry: "Calendar tables + lifecycle",
      detailMarkdown: `## Events / notable dates

### Email body — **full**

- **Pass 1 only** on unique body → event highlight → calendar persist (meetings, cancels, reschedules, deadlines, inspections).
- Post-sync harvest includes events.

### Attachments — **legacy**

- No dedicated highlight harvest on PDF agendas/minutes yet.
- Legacy attachment analysis may surface meetings/deadlines into \`extraction_sources\` if analyze runs; not the primary calendar path.

### Gaps

${BUILDOUT_STAGES.find((s) => s.id === "events")?.remaining.map((l) => `- ${l}`).join("\n") ?? ""}
`,
    },
    {
      id: "todos",
      title: "To-dos",
      buildoutStatus: stageStatus("todos"),
      emailBody: {
        level: "full",
        short: "Pass 1 → action items",
      },
      attachments: {
        level: "search_only",
        short: "Markdown → RAG only",
      },
      harvestPasses: "1 only",
      registry: "`extracted_action_items` / Global To-Dos",
      detailMarkdown: `## To-dos

### Email body — **full**

- **Pass 1 only** on unique body → \`extracted_action_items\` and Global To-Dos (working list + archive split).
- Post-sync harvest includes to-dos.

### Attachments — **search only**

- Attachment markdown is not mined for action items yet (same backlog as contacts).

### Gaps

${BUILDOUT_STAGES.find((s) => s.id === "todos")?.remaining.map((l) => `- ${l}`).join("\n") ?? ""}
`,
    },
    {
      id: "projects",
      title: "Projects",
      buildoutStatus: stageStatus("projects"),
      emailBody: {
        level: "full",
        short: "Passes 1–4 (manual / bulk)",
      },
      attachments: {
        level: "search_only",
        short: "RAG; Meetings V2 for packages",
      },
      harvestPasses: "1 → 2 → 3 → 4",
      registry: "`project_entities` + `project_mentions`",
      detailMarkdown: projectsDetailMarkdown(),
    },
  ];
}
