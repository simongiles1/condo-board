# Project Requirements Document: Condo Board AI Assistant

## 1. Project Overview
A local web application designed to automate and streamline the administrative duties of a condo board member in Toronto. The application uses Google's Gemini AI to generate formal meeting minutes and actionable To-Do lists from transcript files. In a later phase, it will triage and draft responses to condo-related emails. 

* **Deployment:** Local server environment (localhost).
* **Target User:** Single administrative user (Sole board member).

---

## 2. Technology Stack
* **Frontend & Backend:** Next.js (App Router) with React.
* **Styling:** Tailwind CSS.
* **AI Integration:** Google Gemini API (Gemini 1.5 Pro recommended for long-context VTT files and reference PDFs).
* **Database:** SQLite (using an ORM like Prisma or Drizzle) for local history storage.
* **PDF Generation:** `react-pdf` or `html2canvas` + `jspdf` for exporting minutes.

---

## 3. Phase 1: Transcripts to Minutes & To-Do Lists (Core MVP)

### 3.1. Inputs & Data Upload
* **Transcript Upload:** Accept `.vtt` file uploads (exported from Microsoft Teams).
* **Reference Document Upload:** Accept `.pdf` file uploads containing previous meeting minutes to establish style and formatting. 

### 3.2. AI Processing Pipeline (Gemini API)
The backend will execute two distinct AI calls based on the provided inputs:
1. **Meeting Minutes Generation:** Using the "Professional Recording Secretary" prompt to draft formal minutes matching the exact hierarchical structure and tone of the reference PDFs.
2. **To-Do List Extraction:** Using the "Executive Assistant" prompt to extract all assigned tasks, grouped by individual, formatted as checkboxes.

### 3.3. User Interface & Review Process
* **Dashboard:** A home screen showing a history of past meetings and unresolved action items.
* **Generation Page:** File dropzones for the `.vtt` and `.pdf` files.
* **Dual-View Editor:** * A WYSIWYG rich text editor for the Meeting Minutes (allowing manual overrides, additions, and formatting tweaks).
    * A checklist UI (or markdown editor) for the extracted To-Do List.
* **Human-in-the-Loop:** The user must review all AI outputs before finalizing; the system makes no assumptions.

### 3.4. Export & Storage
* **Export:** "Download as PDF" functionality for the finalized meeting minutes.
* **Database Storage:** Save the finalized minutes, To-Do lists, meeting dates, and file references locally in SQLite.

---

## 4. Phase 2: Email Integration (Future Scope)

### 4.1. Email Ingestion (Gmail API — Hybrid Sync)
* **Dedicated condo mailbox:** A separate Gmail account receives auto-forwarded condo emails from the board member's personal Gmail (Gmail filters by sender). New senders are manually forwarded once and added to the app's sender allowlist.
* **Ongoing sync:** The app connects to the dedicated account via Gmail API (OAuth). A configurable cron job (plus manual "Sync now") performs incremental sync using Gmail `historyId` tracking.
* **Historical backfill:** A one-time (and re-runnable) job connects to the personal Gmail account (read-only OAuth) and imports all messages matching the sender allowlist. Dedup uses Gmail message IDs and RFC `Message-ID` headers to avoid duplicates when the same message exists in both mailboxes.
* **Why not IMAP:** Gmail API provides better threading, incremental history sync, label support, and native draft creation for Phase 2.2.

### 4.2. AI Processing 
* **Draft Generation:** Gemini will read incoming emails and draft a proposed response based on the established tone and historical context.

### 4.3. Review & Output
* **Strictly Drafts:** Generated responses are pushed strictly to a "Drafts" folder.
* **No Automated Sending or Flagging:** The system will not auto-send emails or flag them for sentiment/abuse. Every single outgoing communication must be manually proofread, approved, and sent by the user.

---

## 5. Out of Scope
* Cloud hosting (runs locally).
* Multi-user authentication.
* Extrapolating data not present in transcripts.