/** Project mention-frequency chart data for the Entities modal. */

import {
  seriesFrom,
  type MentionChartKind,
  type MentionChartMember,
  type MentionChartPayload,
  type MentionChartStat,
} from "@/lib/contacts/mention-chart";
import { loadProjectFingerprintSummaries } from "@/lib/projects/fingerprint-list";
import { splitProjectMultiValue } from "@/lib/projects/project-multi-values";

function kindForLabel(
  label: string,
  preferred: MentionChartKind,
): MentionChartKind {
  if (preferred !== "name") return preferred;
  return "name";
}

/**
 * Surface bars = project name / contractor / location counted independently
 * (height ≈ distinct source emails for that project). Fingerprint bars = one
 * bar per coalesced project (height = max member surface count).
 */
export async function loadProjectMentionChartData(): Promise<MentionChartPayload> {
  const { projects } = await loadProjectFingerprintSummaries();

  if (projects.length === 0) {
    const empty = seriesFrom([], 0);
    return { surface: empty, fingerprints: empty };
  }

  const surfaceByLabel = new Map<string, MentionChartStat>();

  function bumpSurface(label: string, count: number, kind: MentionChartKind) {
    const trimmed = label.trim();
    if (!trimmed || count <= 0) return;
    const key = `${kind}:${trimmed.toLowerCase()}`;
    const prev = surfaceByLabel.get(key);
    if (prev) {
      prev.count += count;
      return;
    }
    surfaceByLabel.set(key, { label: trimmed, count, kind });
  }

  const fingerprints: MentionChartStat[] = [];

  for (const project of projects) {
    const count = Math.max(project.sourceEmailCount, 0);
    if (count <= 0) continue;

    const members: MentionChartMember[] = [];
    const memberKeys = new Set<string>();
    function pushMember(
      label: string,
      count: number,
      kind: MentionChartKind,
    ) {
      const key = `${kind}:${label.toLowerCase()}`;
      if (memberKeys.has(key)) return;
      memberKeys.add(key);
      members.push({ label, count, kind });
    }

    if (project.name?.trim()) {
      const name = project.name.trim();
      bumpSurface(name, count, "name");
      pushMember(name, count, "name");
    }
    for (const alias of project.aliases ?? []) {
      const trimmed = alias.trim();
      if (!trimmed) continue;
      bumpSurface(trimmed, count, "name");
      pushMember(trimmed, count, "name");
    }
    for (const contractor of splitProjectMultiValue(project.contractor)) {
      bumpSurface(contractor, count, "name");
      pushMember(contractor, count, "name");
    }
    for (const location of splitProjectMultiValue(project.location)) {
      bumpSurface(location, count, "name");
      pushMember(location, count, "name");
    }

    if (members.length === 0) {
      fingerprints.push({
        label: project.displayName,
        count,
        kind: kindForLabel(project.displayName, "name"),
      });
      continue;
    }

    const maxCount = members.reduce((m, row) => Math.max(m, row.count), 0);
    fingerprints.push({
      label: project.displayName,
      count: maxCount,
      kind: kindForLabel(project.displayName, "name"),
      members: members.length > 1 ? members : undefined,
    });
  }

  return {
    surface: seriesFrom([...surfaceByLabel.values()], projects.length),
    fingerprints: seriesFrom(fingerprints, projects.length),
  };
}
