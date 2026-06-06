/** Client-safe meeting row shape — keep in sync with `meetings` in schema.ts. */
export type Meeting = {
  id: string;
  meetingDate: string;
  title: string;
  status: "draft" | "finalized";
  minutesContent: string;
  /** JSON string of structured minutes; null for legacy meetings. */
  minutesJson: string | null;
  /** Cached omissions analysis JSON; null until first run. */
  omissionsAnalysisJson: string | null;
  /** Token usage and estimated cost per AI run; null for legacy meetings. */
  aiUsageJson: string | null;
  todosContent: string;
  /** ISO timestamp when todos were last merged to the global checklist. */
  globalTodosMergedAt: string | null;
  vttFilePath: string;
  pdfFilePath: string;
  boardPackageFilePath: string | null;
  createdAt: string;
  finalizedAt: string | null;
};
