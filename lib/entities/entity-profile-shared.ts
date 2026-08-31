/** Client-safe entity profile types (no DB imports). */

import type { ContactEvidenceScope } from "@/lib/contacts/registry-evidence-shared";
import {
  involveWhenFromJobTitle,
  type InvolveWhen,
} from "@/lib/entities/involve-when";

export const ENTITY_PROFILE_KINDS = [
  "person",
  "organization",
  "project",
  "equipment",
  "event",
] as const;

export type EntityProfileKind = (typeof ENTITY_PROFILE_KINDS)[number];

export function isEntityProfileKind(
  value: string,
): value is EntityProfileKind {
  return (ENTITY_PROFILE_KINDS as readonly string[]).includes(value);
}

export type EntityProfileEmailRow = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  highlightNeedles?: string[];
};

export type EntityProfilePaging = {
  page: number;
  pageSize: number;
  totalPages: number;
  matchedCount: number;
};

type ProfileBase = {
  id: string | null;
  linked: boolean;
  displayName: string;
  initials: string;
  registryHref: string | null;
  /** Name strings to mark in email previews (canonical + every alias). */
  previewNeedles?: string[];
};

/** Deduplicate highlight needles case-insensitively, preserving first-seen casing. */
export function uniquePreviewNeedles(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Canonical name plus every fingerprint alias. Short surfaces such as TCG
 * belong here — profile snippets paint already-listed mention emails; they
 * do not use distinctive-alias LIKE to find mail.
 */
export function orgProfilePreviewNeedles(
  displayName: string,
  aliases: string[],
): string[] {
  return uniquePreviewNeedles([displayName, ...aliases]);
}

/** Union mention-span surfaces with all profile aliases; never replace the set. */
export function snippetNeedlesForEmail(params: {
  previewNeedles?: string[];
  highlightNeedles?: string[];
  fallback: string;
}): string[] {
  return uniquePreviewNeedles([
    ...(params.previewNeedles ?? []),
    ...(params.highlightNeedles ?? []),
    params.fallback,
  ]);
}

export type HighlightMarkKind = "full" | "faded";

/** Focused alias is full strength; siblings stay the same hue at lower opacity. */
export function highlightMarkKind(
  needle: string | undefined,
  focusedAlias: string | null | undefined,
): HighlightMarkKind {
  const focused = focusedAlias?.trim();
  if (!focused) return "full";
  const hit = needle?.trim();
  if (!hit) return "full";
  return hit.toLowerCase() === focused.toLowerCase() ? "full" : "faded";
}

export type PersonProfilePayload = ProfileBase & {
  kind: "person";
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
  involveWhen: InvolveWhen | null;
  emails: EntityProfileEmailRow[];
  paging: EntityProfilePaging;
  scope: ContactEvidenceScope;
  contentCount: number;
  participationOnlyCount: number;
};

export type OrganizationProfilePayload = ProfileBase & {
  kind: "organization";
  role: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  emails: EntityProfileEmailRow[];
  paging: EntityProfilePaging;
};

export type ProjectProfilePayload = ProfileBase & {
  kind: "project";
  yearHint: string | null;
  phase: string | null;
  contractor: string | null;
  location: string | null;
  equipmentMentions: string | null;
  emails: EntityProfileEmailRow[];
  paging: EntityProfilePaging;
};

export type EquipmentProfilePayload = ProfileBase & {
  kind: "equipment";
  manufacturer: string | null;
  category: string | null;
  location: string | null;
  equipmentKind: string | null;
  notes: string | null;
};

export type EventProfilePayload = ProfileBase & {
  kind: "event";
  eventType: string | null;
  startAt: string | null;
  description: string | null;
  calendarHref: string | null;
};

export type EntityProfilePayload =
  | PersonProfilePayload
  | OrganizationProfilePayload
  | ProjectProfilePayload
  | EquipmentProfilePayload
  | EventProfilePayload;

export type EntityProfileResolveHint = {
  kind: EntityProfileKind;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  yearHint?: string | null;
};

export type EntityProfileResolveResult = {
  kind: EntityProfileKind;
  id: string | null;
};

export function profileInitials(
  displayName: string,
  firstName?: string | null,
  lastName?: string | null,
): string {
  const a = firstName?.trim()[0];
  const b = lastName?.trim()[0];
  if (a && b) return `${a}${b}`.toUpperCase();
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0];
    const last = parts[parts.length - 1]?.[0];
    if (first && last) return `${first}${last}`.toUpperCase();
  }
  const single = parts[0];
  if (single && single.length >= 2) return single.slice(0, 2).toUpperCase();
  if (single?.[0]) return single[0].toUpperCase();
  return "?";
}

export function entityRegistryHref(
  kind: EntityProfileKind,
  linked: boolean,
): string | null {
  if (!linked) return null;
  if (kind === "person") return "/knowledge/entities?tab=contacts";
  if (kind === "organization") return "/knowledge/entities?tab=organizations";
  if (kind === "project") return "/knowledge/entities?tab=projects";
  if (kind === "equipment") return "/knowledge/entities?tab=equipment";
  return null;
}

export function emptyProfilePaging(): EntityProfilePaging {
  return { page: 1, pageSize: 25, totalPages: 1, matchedCount: 0 };
}

export function unlinkedPersonProfile(params: {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  organizationName?: string | null;
}): PersonProfilePayload {
  const displayName = params.displayName.trim() || "Unknown contact";
  return {
    kind: "person",
    id: null,
    linked: false,
    displayName,
    initials: profileInitials(displayName, params.firstName, params.lastName),
    registryHref: null,
    firstName: params.firstName ?? null,
    lastName: params.lastName ?? null,
    title: params.title ?? null,
    email: params.email ?? null,
    phone: params.phone ?? null,
    organizationName: params.organizationName ?? null,
    involveWhen: involveWhenFromJobTitle(params.title ?? null),
    emails: [],
    paging: emptyProfilePaging(),
    scope: "content",
    contentCount: 0,
    participationOnlyCount: 0,
  };
}

export function unlinkedOrganizationProfile(params: {
  displayName: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}): OrganizationProfilePayload {
  const displayName = params.displayName.trim() || "Unknown organization";
  return {
    kind: "organization",
    id: null,
    linked: false,
    displayName,
    initials: profileInitials(displayName),
    registryHref: null,
    role: params.role ?? null,
    email: params.email ?? null,
    phone: params.phone ?? null,
    website: params.website ?? null,
    emails: [],
    paging: emptyProfilePaging(),
  };
}

export function unlinkedProjectProfile(params: {
  displayName: string;
  yearHint?: string | null;
  phase?: string | null;
  contractor?: string | null;
  location?: string | null;
  equipmentMentions?: string | null;
}): ProjectProfilePayload {
  const displayName = params.displayName.trim() || "Unknown project";
  return {
    kind: "project",
    id: null,
    linked: false,
    displayName,
    initials: profileInitials(displayName),
    registryHref: null,
    yearHint: params.yearHint ?? null,
    phase: params.phase ?? null,
    contractor: params.contractor ?? null,
    location: params.location ?? null,
    equipmentMentions: params.equipmentMentions ?? null,
    emails: [],
    paging: emptyProfilePaging(),
  };
}
