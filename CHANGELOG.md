# Changelog

All notable changes to the Condo Board AI Assistant are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Gmail OAuth callback redirect** — after connecting Gmail in production, the
  app now redirects to `NEXT_PUBLIC_APP_URL` instead of the container’s internal
  `0.0.0.0:3000` address when running behind Coolify or another reverse proxy.

### Changed

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
