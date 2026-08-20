# Condo Board AI Assistant

Local-first Next.js workspace that converts Microsoft Teams transcripts (`.vtt`) plus precedent PDF board minutes into human-reviewed Markdown outputs using Google Gemini ([PRD](./.doc/prd.md)), while respecting the behavioural contract documented in [.doc/constitution.md](./.doc/constitution.md).

## Prerequisites

1. Node.js 20+
2. Google Gemini API key (Gemini Developer API via Google AI Studio)
3. A machine that can compile `better-sqlite3` native bindings (compiler toolchain on macOS/Linux, MSVC Build Tools on Windows)

## Setup

Copy the env template:

```bash
cp .env.local.example .env.local   # POSIX
copy .env.local.example .env.local # Windows CMD
Copy-Item .env.local.example .env.local # PowerShell
```

Fill values:

```bash
GEMINI_API_KEY=
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require
# Optional overrides
GEMINI_MODEL_MINUTES=gemini-2.0-flash
GEMINI_MODEL_TODOS=gemini-2.0-flash
```

Create dirs and apply migrations against that same Supabase URI:

```bash
mkdir uploads
mkdir data
npm run db:migrate
```

Install + run:

```bash
npm install
npm run dev
```

Visit `http://localhost:3010`.

## Phase 2 email ingestion

1. Create a **Google Cloud OAuth client** (Web application) with redirect URI `http://localhost:3010/api/email/oauth/callback`.
2. Enable the **Gmail API** for that project.
3. On the OAuth consent screen, add both Gmail scopes the app uses:
   `https://www.googleapis.com/auth/gmail.readonly` (personal backfill) and
   `https://www.googleapis.com/auth/gmail.modify` (dedicated mailbox). Add your
   Google account as a **test user** while the app is in Testing mode.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_TOKEN_ENCRYPTION_KEY` in `.env.local`.
5. Set `GMAIL_DEDICATED_EMAIL` to the condo mailbox address so OAuth skips the
   account picker.
6. Open **Emails → Email settings** in the app.
7. Connect the **dedicated condo mailbox** for ongoing sync, and **personal Gmail** for historical backfill.
8. Add condo senders to the allowlist, then run **Backfill all history** once.
9. Configure the cron schedule (default `0 7 * * *`) or use **Sync now** manually.

Autoforward condo-related senders from your personal Gmail to the dedicated mailbox using Gmail filters so ongoing sync stays isolated.

## Shared / hosted access

Phase 2.1 runs locally by default with no login. Before a co-board member accesses the app remotely:

1. Set `AUTH_ENABLED=true`, `AUTH_SECRET`, and `AUTH_USERS` in `.env.local`.
2. Deploy with HTTPS and update `NEXT_PUBLIC_APP_URL` / `GOOGLE_REDIRECT_URI`.
3. Plan a migration from local SQLite to hosted Postgres + object storage (Supabase is a natural fit when you are ready).

## Everyday workflow

1. **Dashboard** — history of workspaces plus unresolved checklist rows parsed during finalize events.
2. **Generate** — upload Teams WebVTT + selectable-text precedent PDF Gemini runs sequentially (minutes prompt then todos prompt).
3. **Meeting workspace** — TipTap markdown ↔ HTML round-trip secretary editor paired with Markdown todos finalize locks records exports PDF snapshots.

Outputs remain on-disk per PRD §3.4 (`./uploads` + `./data`), so back up both folders periodically.

## Troubleshooting

- **Gmail OAuth consent hangs on Continue (dedicated mailbox)** — The dedicated
  connection requests `gmail.modify`, which must be listed on your Google Cloud
  OAuth consent screen (APIs & Services → OAuth consent screen → Edit app → Scopes).
  If you connected personal backfill first, revoke **Condo board** at
  [Google Account permissions](https://myaccount.google.com/permissions), then
  reconnect the dedicated mailbox before personal backfill. Confirm
  `GOOGLE_REDIRECT_URI` matches `http://localhost:3010/api/email/oauth/callback`
  locally (`GET /api/email/oauth/config` shows the active redirect URI and scopes).
  Google Workspace accounts may need an admin to allow third-party `gmail.modify`
  access.
- **Gemini failures** — Verify `GEMINI_API_KEY`, model env vars (`gemini-2.0-flash` must exist on your account), inspect server logs emitted by `/api/generate`.
- **`better-sqlite3` compile errors (Windows)** — Install “Desktop development with C++” workload plus current Windows SDK, reopen shell, rerun `npm install`.
- **`pdf-parse` errors** — Only text-based PDFs work; OCR scans yield empty precedent text and the API rejects the upload.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | `next dev -p 3010` (fixed port for OAuth redirect URI) |
| `npm run dev:restart` | Free port 3010, then start `npm run dev` |
| `npm run build` | Production build (`next build`) |
| `npm run start` | `next start` after build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL migration after editing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending Drizzle migrations (local + Docker) |
| `npm run db:studio` | Drizzle Studio (inspect Postgres) |
