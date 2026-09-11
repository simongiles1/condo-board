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
