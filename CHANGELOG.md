# Changelog

All notable changes to the Condo Board AI Assistant are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Tiered calendar deduplication** — Calendar extractions now use two dedup tiers
  before and after persist. Tier 1 collapses exact duplicates (same date plus
  identical source quote, or same calendar day for meetings) during document
  merge and when writing calendar_events. Tier 2 runs AI thread reconciliation
  after each email analysis to merge semantic duplicates with different wording
  while keeping legitimately distinct events on the same date. The extraction
  panel thread view shows reconciled calendar rows from the database, matching
  the equipment pattern.

- **Equipment extraction redesign (Phase 1)** — Structured `equipment_mentions` with
  `kind` (equipment / manufacturer / component) and `significance` (major / minor).
  Thread-level equipment reconciliation merges duplicate and alias names into canonical
  assets. Insights and Building default to major equipment only, with a toggle to show
  minor items, components, and manufacturers.

- **Building equipment registry (Phase 2 foundation)** — `building_equipment_registry`
  table and import stub for future drawings/specs. Registry entries inject into the
  extraction prompt and drive the 3D Building render when populated.

- **Multiple emails per contact** — Approved person contacts can have more than one
  email address. When email analysis finds a known contact writing from a new
  address, Insights shows an **Additional emails** review card so the board can
  confirm linking it to the existing contact.

### Changed

- **Extraction panel delete dialog** — Thread delete now lists the same extraction
  categories shown in the side panel (Vendors & contracts, Capital projects,
  Calendar, Named entities, and so on) instead of Insights tabs. Selecting all
  categories fully resets the thread for re-analysis; partial deletes remove
  saved rows and archive fields for the chosen categories only.

- **Local dev server** — `npm run dev` now binds to port 3010 (was 3000). Added
  `npm run dev:restart` to free port 3010 and start the dev server again. Update
  `GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, and your Google OAuth client
  redirect URI if you still use `localhost:3000`.

- **Mobile layout (initial pass)** — Header navigation collapses into a hamburger
  menu below the `md` breakpoint. Email inbox processed badges show only the
  message count and processor initials on small screens; date and time stack on
  separate lines with the time on the second line.

### Fixed

- **Extraction panel delete kept maintenance & equipment** — Deleting thread equipment
  data removed maintenance events but left reconciled equipment visible in the side
  panel. Purge now removes orphaned `equipment_assets`, strips equipment fields from
  the extraction archive without re-validating the document, and the thread panel
  always prefers reconciled equipment over raw archive rows.

- **Insights Equipment tab empty for extracted equipment** — Email analysis extracted
  `equipment_mentions` (e.g. booster pump, vendor pump brands) into the side panel
  but only persisted dated `maintenance_events`. Equipment-only threads now save
  each mention to `equipment_assets` and a `mentioned` maintenance event so they
  appear on Insights → Equipment.

- **Header user initials** — The avatar badge now shows the first initial of the
  user's first and last name instead of the first two characters of their email.

- **Email analysis in production** — Idempotent migrations now create and backfill
  the full email-analysis schema on older databases (`extraction_skill_entries`,
  `entity_mentions`, `entity_exclusions`, and related columns). Startup migration
  logs warn when required analysis columns are still missing after migrate.

- **Clear-all sync history** — Deleting all imported emails no longer wipes sync
  history. A **Clear all** row is appended with how many emails and threads were
  removed, so a large re-import on the next sync is easier to explain.

### Changed

- **Sender allowlist layout** — Import estimate and backfill panels now use a
  50/50 split. Add sender moved into a dialog opened from the toolbar above the
  sender list. The sync estimate also shows how many allowlist threads and emails
  are already imported.

- **User deletion** — Super admins can delete users from the Users page. A
  confirmation dialog explains that the account and associated auth data are
  removed while shared app content remains.

- **Date display** — App-wide dates now use long month names (for example,
  June 20, 2026) instead of ISO-style `YYYY-MM-DD` formatting.

- **Allowlist sender sort** — Sender allowlist defaults to **Most in personal
  Gmail** instead of email A–Z.

### Added

- **Allowlist sender thread counts** — In app and Personal columns show email
  counts with thread counts in parentheses (for example, `470 (38)`).

- **Backfill all allowlist** — Sender allowlist tab includes a backfill action
  beside the import estimate that searches personal Gmail for every saved sender
  and imports historical threads not yet in the app. The estimate shows remaining
  unsynced thread and email counts, not the full Gmail total.

- **Allowlist import preview** — Sender allowlist tab shows estimated thread and
  email counts for the next sync from personal Gmail, based on the saved
  allowlist or the current row selection.

- **Stale sync history rows** — Manual or scheduled syncs that never finished
  (e.g. dev server restart or request timeout) are now auto-closed after two
  hours and shown as **Interrupted** instead of staying on **Running…** forever.

  sign-in via middleware and a server layout guard, sending visitors to `/login`
  when auth is enabled and they have no session.

- **User menu when logged out** — The header avatar menu is hidden on login and
  signup pages instead of showing a placeholder “U” with settings.

- **Forgot password flow** — Sign-in page links to forgot password; users receive
  a one-hour reset link by email (SMTP) or a local dev link when email is not
  configured. Reset completes with a new password and signs them in.

### Added

- **Sync history** — Email settings → Sync controls lists recent manual and
  scheduled sync runs with start time, trigger (manual vs cron job), and how
  many allowlist emails were imported (scrollable table, max 300px height).

- **Smarter entity review prefill** — Contact review cards now parse role/title and
  organization from signature-style context snippets (e.g. "Name, Project Manager,
  Company Inc."). Organization cards are listed first. Approving an organization
  automatically links matching pending contacts from the same email thread and
  selects that org in their dropdown.

- **Richer entity review context** — Review snippets now merge thread subject,
  extraction summary, cached PDF attachment text, related surety/bond mentions,
  and the original extracted line. Attachment PDF text is cached alongside the
  file on first read so later page loads stay fast.

- **Organization role customization** — Entity review organization role dropdown now
  includes **+ Add new role…**, which opens a dialog to create reusable custom roles.
  Built-in roles also include **Condominium corporation** for TSCC numbers and
  similar legal corporation names (including sister buildings with different
  corporation numbers).

- **Entity review delete** — Pending entity review cards now include a **Delete**
  button that removes unrelated extractions from the database. **Ignore** still
  keeps the record and tells the AI to skip similar contacts in future emails.

- **User accounts with roles** — Sign up and sign in pages, three roles
  (`super_admin`, `admin`, `user`), and middleware-enforced access. Super admins
  manage all users on `/users`; admins can access every other page; regular users
  can view and analyze content but not admin settings, bulk analysis, concepts, or
  dev notes.

- **Analysis attribution** — Email and thread analysis runs now store
  `triggered_by_user_id` on `extraction_sources` so you can see who ran each
  analysis.

### Changed

- **Action item semantic deduplication** — before persisting new email action
  items, a Gemini pass compares the incoming batch against open tasks in the same
  thread using obligation-level matching (not fuzzy text or exact dedup keys).
  Cross-assignee duplicates (e.g. "Management" vs a named contact for the same
  police-footage request) are consolidated to one insert. Thread reconciliation
  now also clusters open semantic duplicates first and supersedes extras even
  when the obligation is still unresolved.

- **Action item reconciliation scope** — thread reconciliation now runs only against
  emails already analyzed in chronological order (not the full synced thread).
  "Send calendar invite" tasks are excluded from LLM thread reconciliation and
  close only when a separate meeting-invite email (e.g. Microsoft Teams) is
  analyzed.

- **Extractions default view** — the list view on `/extractions` now defaults to
  **By thread** instead of by individual email.

- **Named entities deduplication and display** — extracted people, orgs, dates,
  and phone numbers are merged intelligently (e.g. "Paul" + "Paul Gartenburg",
  "ICC Property Management" + "ICC Property Management Ltd.") in the extractions
  audit UI, on Insights, and when persisting to `entity_mentions`. The Insights
  page now includes a **Named entities** section matching the extraction routing
  link.

- **Named entities audit grouping** — dates are no longer shown in named entities
  (calendar fields cover those). People, organizations, and phone numbers are
  grouped into contact cards when they share email context. In thread audits,
  teal tags show which email each field was extracted from.

- **Named entities completeness** — the audit view now includes organizations
  from both `entities[]` and `vendors[]`, so property managers and other orgs
  flagged only as vendors still appear under Named entities. Vendor-flagged orgs
  show an amber **Vendor candidate** badge.

- **Vendor review queue** — newly extracted vendors are saved as `pending` until
  a board member approves them on Insights, with rename and role selection
  (vendor, property manager, contractor, etc.).

- **Unified entity review** — all extracted people, orgs, and phones are staged
  in `entity_mentions` as pending until approved on Insights **Entity review**.
  Extractions and Insights now use the same grouped contact cards; standalone
  phone-number cards are hidden. Vendor directory entries are created only after
  org approval.

- **AI entity reconciliation** — after each email in a thread is analyzed, a
  follow-up Gemini pass reviews all pending `entity_mentions` for that thread.
  It merges duplicates (e.g. "P. Gartenburg" + "Paul Gartenburg"), fixes wrong
  person/org pairings using signature and From: evidence, and attaches phones to
  the correct contact before human review. Thread view on Extractions shows the
  reconciled entity set from the database.

- **Contact-style entity review** — Insights entity review now uses standard
  contact forms: person cards include first/last name, email, organization
  dropdown, role/title, and phone; organization cards include name, role, email,
  and phone. Approving an organization adds it to person dropdowns above without
  losing in-progress edits. **Ignore** registers stale signatures (e.g. old
  employers) in an exclusion list the AI sees during future extractions.

- **Vendor directory vs organizations** — only vendor and contractor roles are
  added to the vendor directory and shown under Vendors & contracts on
  Extractions after review. Property managers and other roles stay in named
  entities only.

- **Personal Gmail is now the primary sync source** — Sync now and automatic
  (scheduled) sync both pull allowlist-matching mail directly from personal
  Gmail using incremental `historyId` tracking. The dedicated condo mailbox is
  optional and no longer drives sync. Reset imported inbox clears personal sync
  state so the next sync can re-import from scratch. The global backfill button
  was removed; use **Import thread** on a sender row for full conversation
  history per sender.

### Fixed

- **Entity review vendor candidate badge** — approving or ignoring an entity in
  Insights now clears the AI **Vendor candidate** flag; the user's chosen
  organization role is the source of truth after review.

- **Personal forward workflow start** — fixed a crash when scanning large
  personal mailboxes (Postgres parameter limit on the already-forwarded lookup).
  Start now returns immediately and shows live progress while batches run in the
  background.

- **Allowlist personal Gmail counts** — personal From counts now paginate
  through Gmail results instead of using `resultSizeEstimate`, which was returning
  the same mailbox total for every sender. The allowlist table layout was fixed so
  column headers align with their data.

### Added

- **Forward workflow thread count** — the personal forward status panel now
  reports unique Gmail threads alongside individual message counts when a run
  starts (e.g. “10,286 messages in 3,421 threads”).

- **Forward workflow full threads** — matching now expands each allowlist hit to
  the entire Gmail conversation (including your replies and other participants),
  forwards messages oldest-first, and sets In-Reply-To / References so threads
  stay grouped in the dedicated inbox.

- **Email settings — automated personal forward workflow** — forward
  allowlist-matching messages from personal Gmail to the dedicated condo mailbox
  in batches of 50 every 2 minutes. Select sender rows for a subset, or use all
  saved allowlist senders. Tracks already-forwarded messages so reruns skip
  duplicates. Requires reconnecting personal Gmail with `gmail.send` permission.

- **Email settings — sender discovery** — the allowlist shows every unique From
  address in imported mail, with separate counts for messages in the app and in
  connected personal Gmail. Unsaved senders get a Save button; entries already in
  the database show a disabled Saved state with backfill and remove actions.
  Copy a single address or the full Gmail filter OR list from the toolbar.
  Select rows to copy a smaller OR list for split Gmail filters.

- **Email settings — reset imported inbox** — delete all imported emails, threads,
  sync runs, and email extractions from the app so you can run a fresh dedicated
  sync. Gmail connections, allowlist, and mailbox contents are unchanged.

### Fixed

- **Gmail OAuth callback redirect** — after connecting Gmail in production, the
  app now redirects to `NEXT_PUBLIC_APP_URL` instead of the container’s internal
  `0.0.0.0:3000` address when running behind Coolify or another reverse proxy.

- **Gmail dedicated OAuth consent hang** — dedicated mailbox connect now uses
  incremental scope consent (`include_granted_scopes`) and a pinned-account
  flow when `GMAIL_DEDICATED_EMAIL` is set. Settings documents the Google Cloud
  `gmail.modify` scope requirement when consent stalls on Continue.

### Changed

- **Extractions audit card (By email view)** — redesigned for human review
  clarity. The collapsed card now leads with the email summary and a single
  "N facts found" count (extracted facts only, excluding classification
  metadata and tags) instead of the previous hover-only "extracted items" and
  "destinations" badges. The expanded view presents one flat, scannable list of
  extracted facts grouped by destination, with a quiet per-group save signal
  ("Saved → table", "Partly saved", or "Archive only") replacing the per-item
  "Saved to DB" / "Extraction only" pills and the separate "Rows saved from this
  run" block. Summary metadata (document type, summary, urgency, tags) is now
  visually de-emphasized and pinned to the bottom so it no longer competes with
  real extracted facts.

- **Local dev server** — `npm run dev` now always binds to port 3000 so Gmail OAuth
  redirect URIs stay aligned with `GOOGLE_REDIRECT_URI` in `.env.local`.

- **Email backfill cutoff** — the backfill boundary on Email Settings is now
  computed automatically from dedicated sync: one second before the oldest
  message imported from the condo mailbox. The manual date picker was removed.

- **Building email side panel** — attachments appear in a clickable row above
  the message body; tapping opens an inline preview (images and PDFs) without
  download actions. PDF chips use amber styling (not error red); PDF previews
  render with pdf.js instead of a blank iframe.

- **Building 3D viewer (POC)** — temporary model updated to approximate the
  real footprint: six underground parking levels, a wide nine-floor podium, and
  a narrower fifteen-floor tower centered on the podium. Equipment markers and
  floor labels use parking levels (P1–P6) below street level.

- **Email analysis prompts** — calendar-facing fields (`maintenance_events`
  action/equipment, `meetings` type, `deadlines` description) must use sentence
  case, not all lowercase or title case on every word.

- **Emails inbox default view** — `/emails` now opens in **By thread** view;
  use **Individual** or `?view=messages` for the per-message list.

### Added

- **Emails inbox extraction badge** — each thread and message row shows a violet
  metadata badge when analysis has run. Hover to open a popover with document
  type, summary, urgency, tags, per-domain counts, and key extracted facts;
  thread rows group metadata by message when multiple emails were analyzed.

- **Email backfill cutoff date** — on Email settings, set a cutoff date before
  running personal Gmail backfill so only mail received on or before that day is
  imported. Avoids duplicating messages already synced through the dedicated
  mailbox.

- **Building 3D viewer (POC)** — new `/building` page with an interactive
  fictitious multi-floor model: orbit/zoom controls, glowing color-coded equipment
  markers by category (pumps, air handlers, boilers, etc.), hover/click tooltips,
  and a legend to toggle categories. A tab strip switches between the 3D render
  and a table view of equipment assets and maintenance events extracted from
  analyzed emails; the table view has its own Assets / Events tabs. Asset rows
  include a hover popover of linked source emails; event rows link to the source
  email in a side panel without leaving the page.

- **Board package page picker** — when generating a meeting, upload the full
  management report PDF, preview pages, and choose which pages to include (e.g.
  first 15–20); unchecked pages are stripped before Gemini ingestion.

- **Emails inbox bulk analyze** — checkbox per row (messages or threads), select-all
  on the current page, and **Analyze selected** calling the existing batch analysis
  API (50 emails per request).
- **Processed badge cost** — shows total Gemini spend for that message or thread
  (summed across messages in a thread).
- **Processing badge** — amber “Processing N of M” on thread rows while analysis
  runs (analysis queue + polling); thread count and processed status share one badge.
- **Inbox analysis status bar** — shows bulk progress (“Analyzing 3 of 12”),
  waiting queue (“Waiting 2 of 5” per thread), and failed badges; survives page refresh
  via server-side analysis queue.

- **Settings → Delete all processed data** — confirmation dialog removes meeting
  workspaces, email-analysis extractions (calendar, insights, action items,
  discovered facts, analysis queue), and global todos while keeping imported
  emails, threads, and attachments intact. Resets `processed_at` on emails so
  they can be re-analyzed.
- `POST /api/analysis/purge-processed-data` and
  `lib/analysis/purge-processed-data.ts` backing the settings action.
- `meeting_cancellations` extraction array in `EmailExtractionDocument`
  (parsed, merged, and persisted). Lets the LLM signal that an email is a
  cancellation/postponement notice for a previously-scheduled meeting so the
  matching calendar entry can be removed instead of duplicated.
- `scripts/purge-analysis-data.mjs` — wipes all AI-derived analysis data
  (meetings, global todos, extraction sources, calendar events,
  maintenance/budget/invoice/contract/issue/project rows, action items,
  entities, discovered facts, extraction skill tables, analysis queue) and
  resets `emails.processed_at` and attachment analysis cache fields so the
  pipeline can be re-run from scratch. Email bodies, attachments, threads,
  and sync history are left untouched.

### Changed

- **Calendar pipeline is now conservative about what qualifies as an event.**
  - The email-analysis system prompt now explicitly defines what belongs in
    `meetings[]`, `meeting_cancellations[]`, `deadlines[]`,
    `maintenance_events[]`, `inspections[]`, and `action_items[]`. The LLM
    is told to prefer omitting a fact over fabricating a date or status.
  - Meeting calendar-event dedup now keys on `(date, time)` only, not on the
    LLM-extracted `type` string. Multiple emails or attachments describing
    the same meeting (with varying type wording like "Board", "Board
    Meeting", "Board of Directors") now collapse into a single calendar
    entry. Titles are normalized to avoid stuttering like "Board Meeting
    meeting".
- `persistExtractionDocument` processes `meeting_cancellations` before
  meetings: it deletes any existing calendar event for the cancelled slot
  and suppresses any meeting in the same document that occupies the same
  date/time slot (covers the common case of a cancellation email whose
  `.ics` attachment still describes the original invite).

### Removed

- Auto-promotion of `action_items` to `calendar_events`. Previously, every
  action item with a non-null `deadline` (often a soft "by the next meeting"
  date inferred by the LLM) was inserted into the calendar, polluting it
  with entries like "share any thoughts, questions, or recommendations
  regarding the presentation". Action items now live only in the action-item
  table; hard external deadlines must come through `deadlines[]` to reach
  the calendar.

### Migration

After deploying, run `node scripts/purge-analysis-data.mjs` once and then
re-analyze emails from the **Emails** UI (per-thread or per-message
**Re-analyze** button) so the calendar is rebuilt under the new rules.
