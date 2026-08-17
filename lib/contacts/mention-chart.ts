/** Mention-frequency chart data for the Entities page modal. */

import {
  loadContactRegistryPersons,
  type ContactEmailIndexRow,
  loadContactEmailIndex,
} from "@/lib/contacts/registry-load";
import {
  parseEvidenceJson,
  personDisplayName,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import { contactPersonEmails } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export type MentionChartKind = "name" | "email" | "website" | "phone";

export type MentionChartMember = {
  label: string;
  count: number;
  kind: MentionChartKind;
};

export type MentionChartStat = {
  label: string;
  count: number;
  kind: MentionChartKind;
  members?: MentionChartMember[];
};

export type MentionChartSeries = {
  mentions: MentionChartStat[];
  total_mentions: number;
  distinct_labels: number;
  /** Registry rows contributing to this series (analogous to pipeline run_count). */
  run_count: number;
  fallback: boolean;
};

export type MentionChartPayload = {
  surface: MentionChartSeries;
  fingerprints: MentionChartSeries;
};

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

function sortMentions(rows: MentionChartStat[]): MentionChartStat[] {
  return [...rows].sort(
    (a, b) =>
      b.count - a.count ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

export function seriesFrom(
  rows: MentionChartStat[],
  runCount: number,
  fallback = false,
): MentionChartSeries {
  const mentions = sortMentions(rows.filter((r) => r.count > 0 && r.label.trim()));
  return {
    mentions,
    total_mentions: mentions.reduce((sum, m) => sum + m.count, 0),
    distinct_labels: mentions.length,
    run_count: runCount,
    fallback,
  };
}

/**
 * Build surface-form + fingerprint mention series from the global person registry.
 * Surface bars = display names and email addresses counted independently.
 * Fingerprint bars = one bar per person (height = max member count); members list
 * name + linked emails for the hover breakdown (matches condo-insights chart).
 */
export async function loadMentionChartData(limit = 2000): Promise<MentionChartPayload> {
  const persons = await loadContactRegistryPersons({
    limit,
    orderByMention: true,
  });

  if (persons.length === 0) {
    const empty = seriesFrom([], 0);
    return { surface: empty, fingerprints: empty };
  }

  const db = getDb();
  const emailRows = await db
    .select({
      id: contactPersonEmails.id,
      personId: contactPersonEmails.personId,
      email: contactPersonEmails.email,
      evidenceJson: contactPersonEmails.evidenceJson,
    })
    .from(contactPersonEmails)
    .where(
      inArray(
        contactPersonEmails.personId,
        persons.map((p) => p.id),
      ),
    );

  const evidenceCountByEmailAttr = new Map<string, number>();
  for (const row of emailRows) {
    const n = parseEvidenceJson(row.evidenceJson).length;
    evidenceCountByEmailAttr.set(row.id, Math.max(1, n));
  }

  const surfaceByLabel = new Map<string, MentionChartStat>();

  function bumpSurface(label: string, count: number, kind: MentionChartKind) {
    const key = `${kind}:${label.toLowerCase()}`;
    const prev = surfaceByLabel.get(key);
    if (prev) {
      prev.count += count;
      return;
    }
    surfaceByLabel.set(key, { label, count, kind });
  }

  const fingerprints: MentionChartStat[] = [];

  for (const person of persons) {
    const name = personDisplayName(person);
    // Distinct evidence-linked emails — never mentionWeight (ingest score).
    const nameCount = Math.max(person.sourceEmailCount, 0);
    const personEmails = emailRows.filter((e) => e.personId === person.id);

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

    if (name && !looksLikeEmail(name)) {
      if (nameCount > 0) bumpSurface(name, nameCount, "name");
      pushMember(name, nameCount, "name");
    }

    for (const row of personEmails) {
      const email = row.email.trim().toLowerCase();
      if (!email) continue;
      const count = evidenceCountByEmailAttr.get(row.id) ?? 1;
      bumpSurface(email, count, "email");
      pushMember(email, count, "email");
    }

    if (members.length === 0) continue;

    const maxCount = members.reduce((m, row) => Math.max(m, row.count), 0);
    if (maxCount <= 0) continue;

    const label =
      name && !looksLikeEmail(name) ? name : members[0]!.label;
    fingerprints.push({
      label,
      count: maxCount,
      kind: looksLikeEmail(label) ? "email" : "name",
      members: members.length > 1 ? members : undefined,
    });
  }

  // Also include indexed emails that somehow lack a person row surface bump.
  const emailIndex: ContactEmailIndexRow[] = await loadContactEmailIndex(limit);
  for (const row of emailIndex) {
    const email = row.email.trim().toLowerCase();
    if (!email) continue;
    const key = `email:${email}`;
    if (surfaceByLabel.has(key)) continue;
    bumpSurface(email, 1, "email");
  }

  return {
    surface: seriesFrom([...surfaceByLabel.values()], persons.length),
    fingerprints: seriesFrom(fingerprints, persons.length),
  };
}
