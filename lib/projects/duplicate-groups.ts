/**
 * Build project duplicate clusters for the Entities → Projects →
 * Duplicates UI. Fuzzy whole-name matching (with legal-suffix stripping);
 * no auto-merge decisions.
 */

import type { ProjectFingerprintSummary } from "@/lib/projects/fingerprint-list";
import {
  PROJECT_NAME_FUZZY_THRESHOLD,
  projectFuzzyBlockingKeys,
  projectNamesBestSimilarity,
} from "@/lib/projects/project-name-fuzzy";

export type ProjectDuplicateGroupMember = ProjectFingerprintSummary & {
  /** True when the project has no primary name and no aliases. */
  nameless: boolean;
};

export type ProjectDuplicateGroup = {
  id: string;
  kind: "fuzzy_name";
  /** Lowest pairwise score that linked any two members in the cluster (≥ threshold). */
  minLinkScore: number;
  label: string;
  memberCount: number;
  namelessCount: number;
  members: ProjectDuplicateGroupMember[];
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function projectNameVariants(project: ProjectFingerprintSummary): string[] {
  const names: string[] = [];
  if (hasText(project.name)) names.push(project.name!.trim());
  if (hasText(project.displayName) && project.displayName !== project.name) {
    names.push(project.displayName.trim());
  }
  for (const alias of project.aliases ?? []) {
    if (hasText(alias)) names.push(alias.trim());
  }
  return names;
}

function toMember(project: ProjectFingerprintSummary): ProjectDuplicateGroupMember {
  return {
    ...project,
    nameless: projectNameVariants(project).length === 0,
  };
}

function sortMembers(
  members: ProjectDuplicateGroupMember[],
): ProjectDuplicateGroupMember[] {
  return [...members].sort((a, b) => {
    if (a.nameless !== b.nameless) return a.nameless ? -1 : 1;
    const mentionDiff = b.sourceEmailCount - a.sourceEmailCount;
    if (mentionDiff !== 0) return mentionDiff;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

function pickGroupLabel(members: ProjectDuplicateGroupMember[]): string {
  const named = members.filter((m) => !m.nameless);
  if (named.length === 0) return "Unknown";
  // Prefer the name with the most mentions, then the longest display name.
  const ranked = [...named].sort((a, b) => {
    const mentionDiff = b.sourceEmailCount - a.sourceEmailCount;
    if (mentionDiff !== 0) return mentionDiff;
    return b.displayName.length - a.displayName.length;
  });
  return ranked[0]!.displayName;
}

class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(id: string): void {
    if (this.parent.has(id)) return;
    this.parent.set(id, id);
    this.rank.set(id, 0);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent == null) {
      this.add(id);
      return id;
    }
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

/**
 * Cluster registry projects into fuzzy-name duplicate groups.
 * Links any pair whose best name/alias similarity is ≥ threshold, then
 * takes connected components (transitive). Sorted by memberCount desc.
 */
export function buildProjectDuplicateGroups(
  projects: ProjectFingerprintSummary[],
  threshold: number = PROJECT_NAME_FUZZY_THRESHOLD,
): ProjectDuplicateGroup[] {
  const members = projects.map(toMember);
  const named = members.filter((m) => !m.nameless);
  if (named.length < 2) return [];

  const uf = new UnionFind();
  for (const member of named) uf.add(member.id);

  /** Min linking score observed for each eventual root (updated after union). */
  const linkScores: Array<{ a: string; b: string; score: number }> = [];

  // Candidate generation via shared blocking keys — avoids full O(n²) similarity.
  const nameVariants = named.map((m) => projectNameVariants(m));
  const blockIndex = new Map<string, number[]>();
  for (let i = 0; i < named.length; i++) {
    const keys = projectFuzzyBlockingKeys(...nameVariants[i]!);
    for (const key of keys) {
      const list = blockIndex.get(key) ?? [];
      list.push(i);
      blockIndex.set(key, list);
    }
  }

  const candidatePairs = new Set<string>();
  for (const indexes of blockIndex.values()) {
    // Skip very common keys (e.g. "ment", "tion") — they explode pair counts
    // without helping rare near-duplicates.
    if (indexes.length < 2 || indexes.length > 40) continue;
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        const i = indexes[a]!;
        const j = indexes[b]!;
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        candidatePairs.add(`${lo}:${hi}`);
      }
    }
  }

  for (const pair of candidatePairs) {
    const [loRaw, hiRaw] = pair.split(":");
    const i = Number(loRaw);
    const j = Number(hiRaw);
    const left = named[i]!;
    const right = named[j]!;
    const score = projectNamesBestSimilarity(nameVariants[i]!, nameVariants[j]!);
    if (score < threshold) continue;
    uf.union(left.id, right.id);
    linkScores.push({ a: left.id, b: right.id, score });
  }

  const buckets = new Map<string, ProjectDuplicateGroupMember[]>();
  for (const member of named) {
    const root = uf.find(member.id);
    const list = buckets.get(root) ?? [];
    list.push(member);
    buckets.set(root, list);
  }

  const minLinkByRoot = new Map<string, number>();
  for (const link of linkScores) {
    const root = uf.find(link.a);
    // Only count links that stayed inside a multi-member cluster.
    if (uf.find(link.b) !== root) continue;
    const prev = minLinkByRoot.get(root);
    if (prev == null || link.score < prev) {
      minLinkByRoot.set(root, link.score);
    }
  }

  const groups: ProjectDuplicateGroup[] = [];
  for (const [root, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const groupMembers = sortMembers(bucket);
    const sortedIds = [...groupMembers.map((m) => m.id)].sort();
    groups.push({
      id: `fuzzy:${sortedIds.join("|")}`,
      kind: "fuzzy_name",
      minLinkScore: minLinkByRoot.get(root) ?? threshold,
      label: pickGroupLabel(groupMembers),
      memberCount: groupMembers.length,
      namelessCount: 0,
      members: groupMembers,
    });
  }

  groups.sort(
    (a, b) =>
      b.memberCount - a.memberCount ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );

  return groups;
}
