/**
 * Which entity harvests run after ingest when harvest-after-sync is enabled.
 * Stored on `email_sync_settings.harvest_after_sync_kinds_json`; editable in Email Settings.
 */

export type HarvestAfterSyncKind =
  | "contacts"
  | "organizations"
  | "projects"
  | "events"
  | "todos";

/** Stable run order when multiple kinds are enabled. */
export const HARVEST_AFTER_SYNC_KIND_ORDER: readonly HarvestAfterSyncKind[] = [
  "contacts",
  "organizations",
  "events",
  "todos",
  "projects",
];

/** When the JSON column is null (legacy rows), match pre-UI hardcoded behavior. */
export const LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS: readonly HarvestAfterSyncKind[] =
  ["contacts", "organizations", "events", "todos"];

export const HARVEST_AFTER_SYNC_KIND_LABEL: Record<HarvestAfterSyncKind, string> =
  {
    contacts: "Contacts",
    organizations: "Organizations",
    events: "Events",
    todos: "To-dos",
    projects: "Projects",
  };

/**
 * Parses stored JSON into enabled kinds in run order. Unknown values are dropped.
 */
export function parseHarvestAfterSyncKindsJson(
  json: string | null | undefined,
): HarvestAfterSyncKind[] {
  if (json == null || json.trim() === "") {
    return [...LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [...LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS];
    }
    const allowed = new Set<string>(HARVEST_AFTER_SYNC_KIND_ORDER);
    const selected = new Set(
      parsed.filter((item): item is HarvestAfterSyncKind =>
        typeof item === "string" && allowed.has(item),
      ),
    );
    return HARVEST_AFTER_SYNC_KIND_ORDER.filter((kind) => selected.has(kind));
  } catch {
    return [...LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS];
  }
}

/**
 * Serializes enabled kinds for persistence (ordered subset of {@link HARVEST_AFTER_SYNC_KIND_ORDER}).
 */
export function serializeHarvestAfterSyncKinds(
  kinds: readonly HarvestAfterSyncKind[],
): string {
  const enabled = new Set(kinds);
  const ordered = HARVEST_AFTER_SYNC_KIND_ORDER.filter((kind) =>
    enabled.has(kind),
  );
  return JSON.stringify(ordered);
}

/**
 * Validates a client/API payload; returns ordered enabled kinds or null if invalid.
 */
export function normalizeHarvestAfterSyncKindsInput(
  value: unknown,
): HarvestAfterSyncKind[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(HARVEST_AFTER_SYNC_KIND_ORDER);
  const selected = new Set(
    value.filter((item): item is HarvestAfterSyncKind =>
      typeof item === "string" && allowed.has(item),
    ),
  );
  return HARVEST_AFTER_SYNC_KIND_ORDER.filter((kind) => selected.has(kind));
}
