/**
 * Browser-side Pass 1–4 re-harvest for contacts and/or projects.
 * Matches the inbox extract loop: one email per pass 1–3, then pass 4 merge.
 */

import { DEFAULT_CONTACT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/contact-highlight-models";
import {
  mergeExtractWarnings,
  warningsFromExtractPostResponse,
  type ExtractRunWarning,
} from "@/lib/email-analysis/extract-run-warnings";

export type ReharvestKind = "contacts" | "projects";

export type ReharvestProgress = {
  kind: ReharvestKind;
  phase: "preparing" | "pass" | "merge" | "done";
  pass?: 1 | 2 | 3 | 4;
  current?: number;
  total?: number;
};

type PreparedExtractItem = {
  emailId: string;
  highlightedText: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string;
  label: string;
};

function prepareUrl(kind: ReharvestKind): string {
  return kind === "projects"
    ? "/api/analysis/extract-projects/prepare"
    : "/api/analysis/extract-contacts/prepare";
}

function extractUrl(kind: ReharvestKind): string {
  return kind === "projects"
    ? "/api/analysis/extract-projects"
    : "/api/analysis/extract-contacts";
}

function kindLabel(kind: ReharvestKind): string {
  return kind === "projects" ? "projects" : "contacts";
}

export function formatReharvestProgress(progress: ReharvestProgress): string {
  const noun = kindLabel(progress.kind);
  if (progress.phase === "preparing") return `Preparing ${noun}…`;
  if (progress.phase === "merge" || progress.pass === 4) {
    return `Pass 4 · merging ${noun}…`;
  }
  if (progress.phase === "done") return `Finished ${noun}.`;
  const pass = progress.pass ?? 1;
  const current = progress.current ?? 0;
  const total = progress.total ?? 0;
  return `Pass ${pass} · ${noun} (${current} of ${total})`;
}

async function prepareItems(params: {
  kind: ReharvestKind;
  threadId?: string | null;
  emailIds: string[];
}): Promise<PreparedExtractItem[]> {
  const query = params.threadId
    ? `threadId=${encodeURIComponent(params.threadId)}`
    : `emailIds=${encodeURIComponent(params.emailIds.join(","))}`;
  const response = await fetch(`${prepareUrl(params.kind)}?${query}`);
  const data = (await response.json()) as {
    items?: PreparedExtractItem[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? `Could not prepare ${kindLabel(params.kind)}.`);
  }
  return data.items ?? [];
}

async function runPass(params: {
  kind: ReharvestKind;
  items: PreparedExtractItem[];
  model: string;
  pass: 1 | 2 | 3 | 4;
}): Promise<ExtractRunWarning[]> {
  const response = await fetch(extractUrl(params.kind), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: params.items,
      model: params.model,
      pass: params.pass,
    }),
  });
  const data = (await response.json()) as {
    error?: string;
    results?: Array<{
      emailId?: string;
      error?: string;
      skipped?: boolean;
      entityCards?: unknown[];
    }>;
    fourthPass?: { error?: string | null };
  };
  if (!response.ok) {
    throw new Error(
      data.error ??
        `${kindLabel(params.kind)} pass ${params.pass} failed.`,
    );
  }
  return warningsFromExtractPostResponse(params.kind, params.pass, data);
}

export async function reharvestThread(params: {
  threadId?: string | null;
  emailIds?: string[];
  kinds?: ReharvestKind[];
  model?: string;
  onProgress?: (progress: ReharvestProgress) => void;
}): Promise<{
  emailCount: number;
  kinds: ReharvestKind[];
  warnings: ExtractRunWarning[];
}> {
  const kinds = params.kinds?.length
    ? params.kinds
    : (["contacts", "projects"] as ReharvestKind[]);
  const emailIds = [
    ...new Set((params.emailIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  const threadId = params.threadId?.trim() || null;
  if (!threadId && emailIds.length === 0) {
    throw new Error("Pick a thread or at least one email to re-harvest.");
  }
  const model = params.model ?? DEFAULT_CONTACT_HIGHLIGHT_MODEL;

  let emailCount = 0;
  const warnings: ExtractRunWarning[] = [];
  for (const kind of kinds) {
    params.onProgress?.({ kind, phase: "preparing" });
    const items = await prepareItems({ kind, threadId, emailIds });
    if (items.length === 0) {
      throw new Error(`No emails found to re-harvest ${kindLabel(kind)}.`);
    }
    emailCount = Math.max(emailCount, items.length);

    for (const pass of [1, 2, 3] as const) {
      for (let index = 0; index < items.length; index += 1) {
        params.onProgress?.({
          kind,
          phase: "pass",
          pass,
          current: index + 1,
          total: items.length,
        });
        warnings.push(
          ...(await runPass({
            kind,
            items: [items[index]!],
            model,
            pass,
          })),
        );
      }
    }

    params.onProgress?.({
      kind,
      phase: "merge",
      pass: 4,
      current: 1,
      total: 1,
    });
    warnings.push(...(await runPass({ kind, items, model, pass: 4 })));
    params.onProgress?.({ kind, phase: "done" });
  }

  return { emailCount, kinds, warnings };
}
