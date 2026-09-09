/** Pipeline states where automated work may still be in flight. */
export const MEETING_V2_ACTIVE_PIPELINE_STATES = new Set([
  "ingesting",
  "ingested",
  "extracting",
  "extracted",
  "gathering_evidence",
  "evidence_gathered",
  "investigating",
  "investigated",
  "validating",
]);

/** Pipeline states where the UI is waiting on user action, not background work. */
export const MEETING_V2_IDLE_PIPELINE_STATES = new Set([
  "created",
  "validated",
  "failed",
]);

/** Stored pipeline step while the meeting waits on human agenda review. */
export const MEETING_V2_AWAITING_AGENDA_REVIEW_STEP =
  "Awaiting agenda review & approval";

export function isMeetingV2AwaitingHumanStep(
  currentStep: string | null | undefined,
): boolean {
  const step = currentStep?.trim() ?? "";
  return step === MEETING_V2_AWAITING_AGENDA_REVIEW_STEP;
}

/** No progress heartbeat for this long → treat the run as stalled (Resume required). */
export const MEETING_V2_PIPELINE_STALE_MS = 5 * 60 * 1000;

export function isMeetingV2PipelineActivelyRunning(options: {
  pipelineState: string;
  lastError?: string | null;
  updatedAt?: string | null;
  currentStep?: string | null;
}): boolean {
  const { pipelineState, lastError, updatedAt, currentStep } = options;
  if (isMeetingV2AwaitingHumanStep(currentStep)) {
    return false;
  }
  if (
    pipelineState === "failed" ||
    pipelineState === "created" ||
    pipelineState === "validated"
  ) {
    return false;
  }
  if (lastError?.trim()) return false;
  if (updatedAt?.trim()) {
    const updatedMs = Date.parse(updatedAt);
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs > MEETING_V2_PIPELINE_STALE_MS) {
      return false;
    }
  }
  return MEETING_V2_ACTIVE_PIPELINE_STATES.has(pipelineState);
}

const MEETING_V2_PHASE_LABELS: Record<string, string> = {
  ingesting: "Ingest",
  ingested: "Ingest",
  extracting: "Extract",
  extracted: "Extract",
  gathering_evidence: "Evidence",
  evidence_gathered: "Evidence",
  investigating: "Investigate",
  investigated: "Investigate",
  validating: "Validate",
};

export function getMeetingV2PhaseLabel(pipelineState: string): string {
  return MEETING_V2_PHASE_LABELS[pipelineState] ?? "In progress";
}

export function getMeetingV2PipelineStateDescription(pipelineState: string): string {
  if (pipelineState === "validated") {
    return "Automated pipeline finished — ingest through validation are complete.";
  }
  if (pipelineState === "failed") {
    return "The automated pipeline stopped with an error.";
  }
  if (pipelineState === "created") {
    return "Transcript and board package uploaded; pipeline not started yet.";
  }
  return "Automated pipeline is running or paused mid-stage.";
}

export function getMeetingV2CurrentStepPosition(
  workflowProgress: MeetingV2WorkflowProgress,
): {
  stepNumber: number;
  totalCount: number;
  activeStatus: WorkflowStepStatus;
} {
  const inProgressIndex = workflowProgress.steps.findIndex((step) => step.status === "in_progress");
  const firstIncompleteIndex = workflowProgress.steps.findIndex((step) => step.status !== "complete");
  const activeIndex =
    inProgressIndex >= 0
      ? inProgressIndex
      : firstIncompleteIndex >= 0
        ? firstIncompleteIndex
        : workflowProgress.totalCount - 1;

  return {
    stepNumber: activeIndex + 1,
    totalCount: workflowProgress.totalCount,
    activeStatus: workflowProgress.steps[activeIndex]?.status ?? "incomplete",
  };
}

export function buildMeetingV2DisplayProgress(options: {
  pipelineNotStarted: boolean;
  pipelineActivelyRunning: boolean;
  pipelineState: string;
  storedProgressPercent: number | null | undefined;
  storedCurrentStep: string | null | undefined;
  workflowProgress: MeetingV2WorkflowProgress | null;
}): {
  progressPercent: number;
  currentStep: string;
  currentLabel: string;
} {
  const {
    pipelineNotStarted,
    pipelineActivelyRunning,
    pipelineState,
    storedProgressPercent,
    storedCurrentStep,
    workflowProgress,
  } = options;

  if (pipelineNotStarted) {
    return {
      progressPercent: 0,
      currentStep: "Transcript and board package uploaded. Start the pipeline when you are ready.",
      currentLabel: "Ready to start",
    };
  }

  if (isMeetingV2AwaitingHumanStep(storedCurrentStep)) {
    return {
      progressPercent:
        typeof storedProgressPercent === "number" ? storedProgressPercent : 40,
      currentStep: storedCurrentStep!.trim(),
      currentLabel: "Agenda review",
    };
  }

  if (pipelineActivelyRunning) {
    const progressPercent =
      typeof storedProgressPercent === "number" && storedProgressPercent > 0
        ? storedProgressPercent
        : workflowProgress?.progressPercent ?? 0;
    return {
      progressPercent,
      currentStep:
        storedCurrentStep?.trim() ||
        workflowProgress?.currentStep ||
        "Automated pipeline is running.",
      currentLabel: getMeetingV2PhaseLabel(pipelineState),
    };
  }

  if (workflowProgress) {
    return {
      progressPercent: workflowProgress.progressPercent,
      currentStep: workflowProgress.currentStep,
      currentLabel: workflowProgress.currentLabel,
    };
  }

  return {
    progressPercent: typeof storedProgressPercent === "number" ? storedProgressPercent : 0,
    currentStep: storedCurrentStep ?? "Waiting for first run",
    currentLabel: getMeetingV2PhaseLabel(pipelineState),
  };
}

export function shouldPollMeetingV2Status(options: {
  pipelineState: string;
  pipelineHalted?: boolean;
  awaitingBackgroundWork?: boolean;
  currentStep?: string | null;
}): boolean {
  const {
    pipelineState,
    pipelineHalted = false,
    awaitingBackgroundWork = false,
    currentStep,
  } = options;

  if (awaitingBackgroundWork) return true;
  if (pipelineHalted) return false;
  if (isMeetingV2AwaitingHumanStep(currentStep)) return false;
  if (MEETING_V2_IDLE_PIPELINE_STATES.has(pipelineState)) return false;
  return MEETING_V2_ACTIVE_PIPELINE_STATES.has(pipelineState);
}

export type WorkflowStepStatus = "complete" | "in_progress" | "incomplete";

export type MeetingV2WorkflowStep = {
  key: string;
  label: string;
  status: WorkflowStepStatus;
  note: string;
  kind: "pipeline" | "user";
};

export type MeetingV2WorkflowProgress = {
  steps: MeetingV2WorkflowStep[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  currentLabel: string;
  currentStep: string;
  isFullyComplete: boolean;
};

/** Shared stage order for pipeline UI and AI usage breakdown (7 steps). */
export const MEETING_V2_USAGE_STAGE_DEFINITIONS: Array<{
  id: string;
  label: string;
  kind: "pipeline" | "user";
}> = [
  { id: "ingest", label: "Ingest", kind: "pipeline" },
  { id: "extract", label: "Extract", kind: "pipeline" },
  { id: "evidence", label: "Evidence", kind: "pipeline" },
  { id: "investigate", label: "Investigate", kind: "pipeline" },
  { id: "validate", label: "Validate", kind: "pipeline" },
  { id: "agenda_review", label: "Agenda review", kind: "user" },
  { id: "draft_generated", label: "Draft generated", kind: "user" },
];

/** Cumulative % when each step reaches `complete` — matches Inngest stored pipeline progress. */
export const MEETING_V2_STEP_COMPLETE_PERCENT: Record<string, number> = {
  ingest: 20,
  extract: 40,
  evidence: 60,
  investigate: 80,
  validate: 90,
  agenda_review: 95,
  draft_generated: 100,
};

const MEETING_V2_WORKFLOW_STEP_ORDER = MEETING_V2_USAGE_STAGE_DEFINITIONS.map((stage) => stage.id);

/** Weighted progress so post-pipeline agenda review does not drop below late validation %. */
export function computeMeetingV2WorkflowProgressPercent(
  steps: MeetingV2WorkflowStep[],
  options: {
    agendaItemCount: number;
    needsClarificationCount: number;
    flaggedCount: number;
  },
): number {
  if (steps.length === 0) return 0;
  if (steps.every((step) => step.status === "complete")) return 100;

  const inProgress = steps.find((step) => step.status === "in_progress");
  const activeStep =
    inProgress ?? steps.find((step) => step.status !== "complete") ?? steps[steps.length - 1];
  const activeIndex = MEETING_V2_WORKFLOW_STEP_ORDER.indexOf(activeStep.key);
  const floor =
    activeIndex > 0
      ? MEETING_V2_STEP_COMPLETE_PERCENT[MEETING_V2_WORKFLOW_STEP_ORDER[activeIndex - 1]] ?? 0
      : 0;
  const ceiling = MEETING_V2_STEP_COMPLETE_PERCENT[activeStep.key] ?? 100;

  if (activeStep.status !== "in_progress") {
    return floor;
  }

  if (activeStep.key === "agenda_review" && options.agendaItemCount > 0) {
    const readyCount = Math.max(
      0,
      options.agendaItemCount - options.needsClarificationCount - options.flaggedCount,
    );
    const ratio = Math.max(0, Math.min(1, readyCount / options.agendaItemCount));
    return Math.round(floor + (ceiling - floor) * ratio);
  }

  return floor;
}

type PipelineStage = {
  key: string;
  label: string;
  status: WorkflowStepStatus;
  note: string;
};

export function buildMeetingV2WorkflowProgress(options: {
  pipelineStages: PipelineStage[];
  agendaItemCount: number;
  needsClarificationCount: number;
  flaggedCount: number;
  draftCount: number;
  hasLatestDraft: boolean;
}): MeetingV2WorkflowProgress {
  const {
    pipelineStages,
    agendaItemCount,
    needsClarificationCount,
    flaggedCount,
    draftCount,
    hasLatestDraft,
  } = options;

  const pipelineValidated =
    pipelineStages.length > 0 &&
    pipelineStages.every((stage) => stage.status === "complete");

  const agendaReviewComplete =
    pipelineValidated &&
    agendaItemCount > 0 &&
    needsClarificationCount === 0 &&
    flaggedCount === 0;

  const draftGenerated = draftCount > 0 || hasLatestDraft;

  const agendaReviewStatus: WorkflowStepStatus = !pipelineValidated
    ? "incomplete"
    : agendaReviewComplete
      ? "complete"
      : "in_progress";

  const draftStatus: WorkflowStepStatus = !agendaReviewComplete
    ? "incomplete"
    : draftGenerated
      ? "complete"
      : "in_progress";

  const steps: MeetingV2WorkflowStep[] = [
    ...pipelineStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      status: stage.status,
      note: stage.note,
      kind: "pipeline" as const,
    })),
    {
      key: "agenda_review",
      label: "Agenda review",
      status: agendaReviewStatus,
      note: agendaReviewComplete
        ? "All agenda items are clear of open questions and validation flags."
        : !pipelineValidated
          ? "Available after the automated pipeline finishes validation."
          : needsClarificationCount > 0
            ? `${needsClarificationCount} item(s) still have open questions.`
            : flaggedCount > 0
              ? `${flaggedCount} item(s) still have validation flags.`
              : "Review agenda items in the Agenda Review tab.",
      kind: "user",
    },
    {
      key: "draft_generated",
      label: "Draft generated",
      status: draftStatus,
      note: draftGenerated
        ? "A minutes draft has been generated."
        : agendaReviewComplete
          ? "Generate a minutes draft from the Draft Preview tab."
          : "Complete agenda review before generating the draft.",
      kind: "user",
    },
  ];

  const completedCount = steps.filter((step) => step.status === "complete").length;
  const totalCount = steps.length;
  const progressPercent = computeMeetingV2WorkflowProgressPercent(steps, {
    agendaItemCount,
    needsClarificationCount,
    flaggedCount,
  });
  const firstIncomplete = steps.find((step) => step.status !== "complete");
  const inProgress = steps.find((step) => step.status === "in_progress");

  const currentLabel = progressPercent === 100
    ? "Complete"
    : inProgress?.label ?? firstIncomplete?.label ?? "In progress";

  const currentStep = progressPercent === 100
    ? "All pipeline and review steps are complete."
    : inProgress?.note ?? firstIncomplete?.note ?? "Waiting to start.";

  return {
    steps,
    completedCount,
    totalCount,
    progressPercent,
    currentLabel,
    currentStep,
    isFullyComplete: progressPercent === 100,
  };
}
