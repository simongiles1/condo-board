/**
 * Client-safe helpers for surfacing per-email extraction failures that return
 * HTTP 200 with an `error` field on individual results (e.g. Gemini 429).
 */

export type ExtractPipelineKind =
  | "contacts"
  | "organizations"
  | "projects"
  | "events"
  | "todos";

export type ExtractRunWarning = {
  severity: "error" | "warning";
  kind: ExtractPipelineKind;
  pass?: number;
  emailId?: string;
  message: string;
};

export type ExtractRunNotice = {
  tone: "success" | "warning" | "error";
  title: string;
  lines: string[];
};

type PostResultItem = {
  emailId?: string;
  error?: string;
  skipped?: boolean;
  entityCards?: unknown[];
  entity_cards?: unknown[];
};

type PostResponseBody = {
  results?: PostResultItem[];
  fourthPass?: { error?: string | null };
};

const KIND_LABEL: Record<ExtractPipelineKind, string> = {
  contacts: "Contact",
  organizations: "Organization",
  projects: "Project",
  events: "Event",
  todos: "To-do",
};

/** Shorten noisy provider errors for inbox banners. */
export function shortenExtractApiError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Extraction failed.";
  if (
    trimmed.includes("exceeded its monthly spending cap") ||
    trimmed.includes("spend cap")
  ) {
    return "Gemini spending cap exceeded — raise your cap in AI Studio or switch extraction models.";
  }
  if (trimmed.includes("429 Too Many Requests") || trimmed.includes("[429")) {
    return "AI API rate limit (429) — try again later or switch models.";
  }
  if (trimmed.length > 220) {
    return `${trimmed.slice(0, 217)}…`;
  }
  return trimmed;
}

function fingerprintCardCount(result: PostResultItem): number {
  const cards = result.entityCards ?? result.entity_cards;
  return Array.isArray(cards) ? cards.length : 0;
}

/** Collect per-email errors and empty fingerprint warnings from a POST body. */
export function warningsFromExtractPostResponse(
  kind: ExtractPipelineKind,
  pass: number,
  data: PostResponseBody,
): ExtractRunWarning[] {
  const warnings: ExtractRunWarning[] = [];
  const kindLabel = KIND_LABEL[kind];

  for (const result of data.results ?? []) {
    if (result.error) {
      warnings.push({
        severity: "error",
        kind,
        pass,
        emailId: result.emailId,
        message: shortenExtractApiError(result.error),
      });
      continue;
    }

    if (pass === 3 && (kind === "projects" || kind === "contacts")) {
      if (!result.skipped && fingerprintCardCount(result) === 0) {
        warnings.push({
          severity: "warning",
          kind,
          pass,
          emailId: result.emailId,
          message: `${kindLabel} pass 3 returned no fingerprint cards for this email.`,
        });
      }
    }
  }

  if (pass === 4 && data.fourthPass?.error) {
    warnings.push({
      severity: "error",
      kind,
      pass: 4,
      message: shortenExtractApiError(data.fourthPass.error),
    });
  }

  return warnings;
}

function groupWarningLines(warnings: ExtractRunWarning[]): string[] {
  const groups = new Map<string, { count: number; sampleEmailId?: string }>();

  for (const warning of warnings) {
    const key = [
      warning.severity,
      warning.kind,
      warning.pass ?? "",
      warning.message,
    ].join("\0");
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, {
        count: 1,
        sampleEmailId: warning.emailId,
      });
    }
  }

  const lines: string[] = [];
  for (const [key, group] of groups) {
    const [severity, kind, pass, message] = key.split("\0");
    const kindLabel = KIND_LABEL[kind as ExtractPipelineKind] ?? kind;
    const passLabel = pass ? `pass ${pass}` : "merge";
    const countLabel =
      group.count > 1 ? ` (${group.count} emails)` : group.sampleEmailId
        ? ` (email ${group.sampleEmailId.slice(0, 8)}…)`
        : "";
    const prefix =
      severity === "error"
        ? `${kindLabel} ${passLabel} failed${countLabel}: `
        : `${kindLabel} ${passLabel}${countLabel}: `;
    lines.push(`${prefix}${message}`);
  }

  return lines;
}

/** Build a dismissible inbox notice from collected warnings. */
export function buildExtractRunNotice(params: {
  warnings: ExtractRunWarning[];
  successTitle: string;
  successDetail?: string;
  problemTitle: string;
}): ExtractRunNotice {
  const errors = params.warnings.filter((w) => w.severity === "error");
  const soft = params.warnings.filter((w) => w.severity === "warning");

  if (errors.length === 0 && soft.length === 0) {
    return {
      tone: "success",
      title: params.successTitle,
      lines: params.successDetail ? [params.successDetail] : [],
    };
  }

  const lines = groupWarningLines(params.warnings);
  return {
    tone: errors.length > 0 ? "error" : "warning",
    title: params.problemTitle,
    lines,
  };
}

export function mergeExtractWarnings(
  ...groups: ExtractRunWarning[][]
): ExtractRunWarning[] {
  return groups.flat();
}
