/** Organization mention-frequency chart data for the Entities modal. */

import {
  seriesFrom,
  type MentionChartKind,
  type MentionChartMember,
  type MentionChartPayload,
  type MentionChartStat,
} from "@/lib/contacts/mention-chart";
import { loadOrgFingerprintSummaries } from "@/lib/organizations/fingerprint-list";
import { splitOrgMultiValue } from "@/lib/organizations/org-multi-values";

function kindForLabel(
  label: string,
  preferred: MentionChartKind,
): MentionChartKind {
  if (preferred !== "name") return preferred;
  return label.includes("@") ? "email" : "name";
}

/**
 * Surface bars = org name / email / website / phone counted independently
 * (height ≈ distinct source emails for that org). Fingerprint bars = one bar
 * per coalesced org (height = max member surface count).
 */
export async function loadOrganizationMentionChartData(
  limit = 2000,
): Promise<MentionChartPayload> {
  const { organizations } = await loadOrgFingerprintSummaries({ limit });

  if (organizations.length === 0) {
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

  for (const org of organizations) {
    const count = Math.max(org.sourceEmailCount, 0);
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

    if (org.name?.trim()) {
      const name = org.name.trim();
      bumpSurface(name, count, "name");
      pushMember(name, count, "name");
    }
    for (const alias of org.aliases ?? []) {
      const trimmed = alias.trim();
      if (!trimmed) continue;
      bumpSurface(trimmed, count, "name");
      pushMember(trimmed, count, "name");
    }
    for (const email of splitOrgMultiValue(org.email)) {
      const normalized = email.toLowerCase();
      bumpSurface(normalized, count, "email");
      pushMember(normalized, count, "email");
    }
    for (const website of splitOrgMultiValue(org.website)) {
      bumpSurface(website, count, "website");
      pushMember(website, count, "website");
    }
    for (const phone of splitOrgMultiValue(org.phone)) {
      bumpSurface(phone, count, "phone");
      pushMember(phone, count, "phone");
    }

    if (members.length === 0) {
      fingerprints.push({
        label: org.displayName,
        count,
        kind: kindForLabel(org.displayName, "name"),
      });
      continue;
    }

    const maxCount = members.reduce((m, row) => Math.max(m, row.count), 0);
    fingerprints.push({
      label: org.displayName,
      count: maxCount,
      kind: kindForLabel(org.displayName, "name"),
      members: members.length > 1 ? members : undefined,
    });
  }

  return {
    surface: seriesFrom([...surfaceByLabel.values()], organizations.length),
    fingerprints: seriesFrom(fingerprints, organizations.length),
  };
}
