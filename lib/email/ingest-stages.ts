export const INGEST_STAGES = [
  "a_ingest",
  "b_discover",
  "c_allowlist",
  "d_expand",
  "e1_docling",
  "e2_file_cards",
  "e3_embed",
  "e4_harvest",
  "done",
] as const;

/** Stages shown on the ingest progress meter (excludes terminal `done`). */
export const INGEST_PIPELINE_STAGES = INGEST_STAGES.filter(
  (stage) => stage !== "done",
) as Exclude<IngestStage, "done">[];

export type IngestStage = (typeof INGEST_STAGES)[number];

export type IngestStageMeterSegment = {
  stage: Exclude<IngestStage, "done">;
  label: string;
  state: "done" | "active" | "pending";
};

export function ingestStageMeterSegments(
  run: Pick<IngestRunPublic, "stage" | "status">,
): IngestStageMeterSegment[] {
  const currentIndex = INGEST_PIPELINE_STAGES.indexOf(
    run.stage as Exclude<IngestStage, "done">,
  );
  const allDone = run.status === "completed";
  return INGEST_PIPELINE_STAGES.map((stage, index) => {
    let state: IngestStageMeterSegment["state"] = "pending";
    if (allDone) {
      state = "done";
    } else if (currentIndex < 0) {
      state = index === 0 ? "active" : "pending";
    } else if (index < currentIndex) {
      state = "done";
    } else if (index === currentIndex) {
      state = "active";
    }
    return {
      stage,
      label: ingestStageShortLabel(stage),
      state,
    };
  });
}

export function ingestStageShortLabel(
  stage: Exclude<IngestStage, "done">,
): string {
  switch (stage) {
    case "a_ingest":
      return "Catch-up";
    case "b_discover":
      return "Discover";
    case "c_allowlist":
      return "Allowlist";
    case "d_expand":
      return "History";
    case "e1_docling":
      return "Docling";
    case "e2_file_cards":
      return "File cards";
    case "e3_embed":
      return "Embed";
    case "e4_harvest":
      return "Harvest";
  }
}

export type IngestWaitKind = "allowlist" | "continue";

export function isIngestStage(value: string): value is IngestStage {
  return (INGEST_STAGES as readonly string[]).includes(value);
}

export function nextIngestStage(
  stage: IngestStage,
  options: { harvestEnabled: boolean },
): IngestStage {
  if (stage === "e3_embed" && !options.harvestEnabled) return "done";
  const index = INGEST_STAGES.indexOf(stage);
  if (index < 0 || index >= INGEST_STAGES.length - 1) return "done";
  return INGEST_STAGES[index + 1]!;
}

export function ingestStageLabel(stage: IngestStage): string {
  switch (stage) {
    case "a_ingest":
      return "Pull mail since last successful sync";
    case "b_discover":
      return "Find new From/To/CC addresses";
    case "c_allowlist":
      return "Confirm new allowlist senders";
    case "d_expand":
      return "Import full history for approved senders";
    case "e1_docling":
      return "Download attachments and run Docling/vision";
    case "e2_file_cards":
      return "Create file cards";
    case "e3_embed":
      return "Embed new emails and files";
    case "e4_harvest":
      return "Harvest contacts, orgs, events, and to-dos";
    case "done":
      return "Pipeline complete";
  }
}

export type IngestSenderReviewPublic = {
  id: string;
  email: string;
  status: "pending" | "approved" | "denied";
  sortIndex: number;
  estimatedThreadCount: number | null;
  estimatedEmailCount: number | null;
};

export type IngestRunPublic = {
  id: string;
  trigger: "cron" | "manual";
  status:
    | "running"
    | "waiting_allowlist"
    | "waiting_continue"
    | "completed"
    | "failed";
  stage: IngestStage;
  waitKind: IngestWaitKind | null;
  lastSuccessfulSyncAt: string | null;
  newEmailIds: string[];
  counts: Record<string, unknown>;
  cursorIndex: number;
  reminderSentAt: string | null;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  senders: IngestSenderReviewPublic[];
};

export function shouldResumeIdleIngestRun(input: {
  status: IngestRunPublic["status"];
  pipelineBusy: boolean;
}): boolean {
  return input.status === "running" && !input.pipelineBusy;
}

export type HarvestSummaryKindRow = {
  kind: string;
  status: string;
  totalEmails: number;
  completedEmails: number;
  failedThreads?: number;
  error?: string | null;
};

export type HarvestSummaryInput = {
  status: "disabled" | "skipped_busy" | "ran";
  kinds: HarvestSummaryKindRow[];
};

export type IngestSummaryRow = {
  label: string;
  detail: string;
  tone: "ok" | "warn" | "error";
};

function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function harvestKindPlural(kind: string): string {
  if (kind === "todos") return "to-dos";
  return kind;
}

function harvestKindSingular(kind: string): string {
  if (kind === "todos") return "to-do";
  if (kind.endsWith("s")) return kind.slice(0, -1);
  return kind;
}

function asCount(counts: Record<string, unknown>, key: string): number | null {
  const value = counts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatHarvestKindSentence(row: HarvestSummaryKindRow): string | null {
  if (row.status === "skipped_empty") return null;
  if (row.status === "skipped_busy") {
    return `${harvestKindPlural(row.kind)} harvest skipped because another bulk extract was already running.`;
  }
  if (row.status === "failed") {
    const error = row.error?.trim();
    return error
      ? `${harvestKindPlural(row.kind)} harvest failed: ${error}`
      : `${harvestKindPlural(row.kind)} harvest failed.`;
  }
  if (row.status !== "completed" || row.totalEmails <= 0) return null;

  const noun = harvestKindSingular(row.kind);
  const done = row.completedEmails;
  const total = row.totalEmails;
  const missed = Math.max(0, total - done);
  if (missed === 0) {
    return `Filled missing ${noun} harvests on all ${countNoun(total, "email")} that needed them.`;
  }
  const remaining =
    missed === 1
      ? "The remaining 1 email was not harvested"
      : `The remaining ${missed.toLocaleString()} emails were not harvested`;
  const failedThreads = row.failedThreads ?? 0;
  const why =
    failedThreads > 0
      ? ` because ${countNoun(failedThreads, "thread")} failed`
      : "";
  return `Filled missing ${noun} harvests on ${done.toLocaleString()} of ${countNoun(total, "email")} that needed them. ${remaining}${why} — those emails still need ${noun} extraction (not an expected skip).`;
}

export function formatHarvestAfterSyncMessage(
  harvest: HarvestSummaryInput,
): string | null {
  if (harvest.status === "disabled") return null;
  if (harvest.status === "skipped_busy") {
    return "Harvest skipped: a bulk extract is already running.";
  }

  const ran = harvest.kinds.filter(
    (row) => row.status === "completed" && row.totalEmails > 0,
  );
  const failed = harvest.kinds.filter((row) => row.status === "failed");
  const skippedBusy = harvest.kinds.filter(
    (row) => row.status === "skipped_busy",
  );
  const skippedEmpty = harvest.kinds.filter(
    (row) => row.status === "skipped_empty",
  );

  if (failed.length > 0) {
    const names = joinList(failed.map((row) => harvestKindPlural(row.kind)));
    const details = failed
      .map((row) => formatHarvestKindSentence(row))
      .filter((line): line is string => Boolean(line));
    return [`Harvest finished with errors (${names}).`, ...details].join(" ");
  }
  if (skippedBusy.length > 0 && ran.length === 0) {
    return "Harvest skipped: a bulk extract is already running.";
  }
  if (ran.length === 0) {
    return "No emails were missing contact, organization, event, or to-do harvests.";
  }

  const sentences = ran
    .map((row) => formatHarvestKindSentence(row))
    .filter((line): line is string => Boolean(line));
  if (skippedEmpty.length > 0) {
    sentences.push(
      `${joinList(skippedEmpty.map((row) => harvestKindPlural(row.kind)))} had no emails missing harvests.`,
    );
  }
  return sentences.join(" ");
}

export function parseHarvestedMissingNote(
  note: string,
): HarvestSummaryKindRow[] | null {
  const trimmed = note.trim().replace(/\.$/, "");
  const prefix = "Harvested missing ";
  if (!trimmed.startsWith(prefix)) return null;
  const parts = trimmed.slice(prefix.length).split(";");
  const rows: HarvestSummaryKindRow[] = [];
  for (const part of parts) {
    const match = /^(\S+)\s+(\d+)\/(\d+)$/.exec(part.trim());
    if (!match) return null;
    rows.push({
      kind: match[1]!,
      status: "completed",
      completedEmails: Number(match[2]),
      totalEmails: Number(match[3]),
      failedThreads: 0,
      error: null,
    });
  }
  return rows.length > 0 ? rows : null;
}

function harvestSummaryFromCounts(
  counts: Record<string, unknown>,
): HarvestSummaryInput | null {
  const status = counts.harvest;
  const rawKinds = counts.harvestKinds;
  if (
    (status === "disabled" || status === "skipped_busy" || status === "ran") &&
    Array.isArray(rawKinds)
  ) {
    const kinds = rawKinds.filter(
      (row): row is HarvestSummaryKindRow =>
        Boolean(row) &&
        typeof row === "object" &&
        typeof (row as HarvestSummaryKindRow).kind === "string",
    );
    return { status, kinds };
  }
  if (status === "disabled") return { status: "disabled", kinds: [] };
  if (status === "skipped_busy") return { status: "skipped_busy", kinds: [] };

  const note = typeof counts.stageNote === "string" ? counts.stageNote : null;
  if (!note) return null;
  const parsed = parseHarvestedMissingNote(note);
  if (parsed) return { status: "ran", kinds: parsed };
  return null;
}

export function ingestRunSummaryRows(run: IngestRunPublic): IngestSummaryRow[] {
  const counts = run.counts;
  const rows: IngestSummaryRow[] = [];
  const emailCount = run.newEmailIds.length;
  rows.push({
    label: "Emails in this run",
    detail:
      emailCount === 0
        ? "No new emails were added to the archive."
        : `${countNoun(emailCount, "email")} ${emailCount === 1 ? "is" : "are"} now in the archive from this pipeline (catch-up plus any approved-sender history).`,
    tone: "ok",
  });

  const messagesAdded = asCount(counts, "messagesAdded");
  const messagesSkipped = asCount(counts, "messagesSkipped");
  if (messagesAdded != null) {
    const skipped =
      messagesSkipped != null && messagesSkipped > 0
        ? ` ${messagesSkipped.toLocaleString()} already in the archive.`
        : "";
    rows.push({
      label: "Catch-up",
      detail: `Gmail import: ${messagesAdded.toLocaleString()} new.${skipped}`.trim(),
      tone: "ok",
    });
  }

  const approved = run.senders.filter((row) => row.status === "approved").length;
  const denied = run.senders.filter((row) => row.status === "denied").length;
  const pending = run.senders.filter((row) => row.status === "pending").length;
  if (run.senders.length > 0) {
    rows.push({
      label: "Allowlist",
      detail: `${countNoun(approved, "sender")} approved, ${countNoun(denied, "sender")} denied${pending > 0 ? `, ${countNoun(pending, "sender")} still pending` : ""}.`,
      tone: pending > 0 ? "warn" : "ok",
    });
  } else {
    rows.push({
      label: "Allowlist",
      detail: "No new From/To/CC addresses needed review.",
      tone: "ok",
    });
  }

  const expandAdded = asCount(counts, "expandAdded");
  const approvedSenders = asCount(counts, "approvedSenders") ?? approved;
  if (expandAdded != null) {
    rows.push({
      label: "Full history",
      detail:
        approvedSenders === 0
          ? "No new senders approved; skipped the full-history pull."
          : `Imported ${countNoun(expandAdded, "message")} from ${countNoun(approvedSenders, "approved sender")}.`,
      tone: "ok",
    });
  }

  const downloaded = asCount(counts, "attachmentsDownloaded");
  const hashes = asCount(counts, "extractionHashes");
  if (downloaded != null || hashes != null) {
    rows.push({
      label: "Attachments & Docling",
      detail: `Downloaded ${countNoun(downloaded ?? 0, "attachment")}; queued ${countNoun(hashes ?? 0, "document")} for Docling/vision.`,
      tone: "ok",
    });
  }

  const fileCards = asCount(counts, "fileCards");
  if (fileCards != null) {
    rows.push({
      label: "File cards",
      detail:
        fileCards === 0
          ? "No new file cards were needed."
          : `Created file cards for ${countNoun(fileCards, "document")}.`,
      tone: "ok",
    });
  }

  const chunks = asCount(counts, "embedChunks");
  const slices = asCount(counts, "embedSlices");
  if (chunks != null) {
    rows.push({
      label: "Embeddings",
      detail: `Embedded ${countNoun(chunks, "chunk")}${slices != null ? ` across ${countNoun(slices, "slice")}` : ""}.`,
      tone: "ok",
    });
  }

  const harvest = harvestSummaryFromCounts(counts);
  const harvestMessage = harvest
    ? formatHarvestAfterSyncMessage(harvest)
    : typeof counts.stageNote === "string"
      ? counts.stageNote
      : null;
  if (harvestMessage) {
    const incomplete =
      harvest?.kinds.some(
        (row) =>
          row.status === "failed" ||
          (row.status === "completed" && row.completedEmails < row.totalEmails),
      ) ?? /not harvested|failed/i.test(harvestMessage);
    rows.push({
      label: "Harvest",
      detail: harvestMessage,
      tone: incomplete ? "warn" : "ok",
    });
  }

  if (run.lastError) {
    rows.push({
      label: "Error",
      detail: run.lastError,
      tone: "error",
    });
  }

  return rows;
}

export function formatIngestRunSummaryText(run: IngestRunPublic): string {
  const heading =
    run.status === "failed"
      ? "Email ingest pipeline failed."
      : "Email ingest pipeline complete.";
  const lines = [heading, ""];
  for (const row of ingestRunSummaryRows(run)) {
    lines.push(`${row.label}: ${row.detail}`);
  }
  return lines.join("\n");
}
