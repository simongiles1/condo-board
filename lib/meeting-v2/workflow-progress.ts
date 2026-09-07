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

export function isMeetingV2PipelineActivelyRunning(options: {
  pipelineState: string;
  lastError?: string | null;
}): boolean {
  const { pipelineState, lastError } = options;
  if (
    pipelineState === "failed" ||
    pipelineState === "created" ||
    pipelineState === "validated"
  ) {
    return false;
  }
  if (lastError?.trim()) return false;
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
}): boolean {
  const {
    pipelineState,
    pipelineHalted = false,
    awaitingBackgroundWork = false,
  } = options;

  if (awaitingBackgroundWork) return true;
  if (pipelineHalted) return false;
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
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
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
