/** Group-level harvest highlight theme (contacts / orgs / projects / events / to-dos). */

export const HARVEST_GROUPS = [
  "contact",
  "organization",
  "project",
  "event",
  "todo",
] as const;

export type HarvestGroupId = (typeof HARVEST_GROUPS)[number];

export const HARVEST_GROUP_LABELS: Record<HarvestGroupId, string> = {
  contact: "Contacts",
  organization: "Organizations",
  project: "Projects",
  event: "Events",
  todo: "To-dos",
};

/** Lower = more specific; used when two groups claim the same range. */
export const HARVEST_GROUP_PRIORITY: Record<HarvestGroupId, number> = {
  contact: 0,
  organization: 1,
  project: 2,
  event: 3,
  todo: 4,
};

export const HARVEST_GROUP_MARK_CLASS: Record<HarvestGroupId, string> = {
  contact:
    "rounded-sm bg-violet-200/90 text-violet-950 ring-1 ring-violet-300/50 box-decoration-clone px-0.5",
  organization:
    "rounded-sm bg-fuchsia-200/90 text-fuchsia-950 ring-1 ring-fuchsia-300/50 box-decoration-clone px-0.5",
  project:
    "rounded-sm bg-orange-200/90 text-orange-950 ring-1 ring-orange-300/50 box-decoration-clone px-0.5",
  event:
    "rounded-sm bg-sky-200/80 text-sky-950 ring-1 ring-sky-300/50 box-decoration-clone px-0.5",
  todo:
    "rounded-sm bg-lime-200/80 text-lime-950 ring-1 ring-lime-300/50 box-decoration-clone px-0.5",
};

export const HARVEST_GROUP_SWATCH_CLASS: Record<HarvestGroupId, string> = {
  contact: "bg-violet-200 ring-violet-300 text-violet-950",
  organization: "bg-fuchsia-200 ring-fuchsia-300 text-fuchsia-950",
  project: "bg-orange-200 ring-orange-300 text-orange-950",
  event: "bg-sky-200 ring-sky-300 text-sky-950",
  todo: "bg-lime-200 ring-lime-300 text-lime-950",
};

export type HarvestIconId =
  | "person"
  | "phone"
  | "briefcase"
  | "building"
  | "badge"
  | "globe"
  | "calendar"
  | "calendar-x"
  | "calendar-move"
  | "flag"
  | "clipboard"
  | "wrench"
  | "checklist";

export const CONTACT_HARVEST_ICONS: Record<string, HarvestIconId> = {
  contact_name: "person",
  phone: "phone",
  job_title: "briefcase",
  company_name: "building",
};

export const ORG_HARVEST_ICONS: Record<string, HarvestIconId> = {
  organization_name: "building",
  phone: "phone",
  organization_role: "badge",
  website: "globe",
};

export const PROJECT_HARVEST_ICONS: Record<string, HarvestIconId> = {
  project_name: "clipboard",
  year_hint: "calendar",
  phase: "flag",
  contractor: "building",
  location: "wrench",
};

export const EVENT_HARVEST_ICONS: Record<string, HarvestIconId> = {
  meeting: "calendar",
  cancellation: "calendar-x",
  reschedule: "calendar-move",
  deadline: "flag",
  inspection: "clipboard",
  maintenance: "wrench",
};

export const TODO_HARVEST_ICONS: Record<string, HarvestIconId> = {
  action_item: "checklist",
};

export function harvestIconFor(
  group: HarvestGroupId,
  type: string,
): HarvestIconId {
  if (group === "contact") return CONTACT_HARVEST_ICONS[type] ?? "person";
  if (group === "organization") return ORG_HARVEST_ICONS[type] ?? "building";
  if (group === "project") return PROJECT_HARVEST_ICONS[type] ?? "clipboard";
  if (group === "todo") return TODO_HARVEST_ICONS[type] ?? "checklist";
  return EVENT_HARVEST_ICONS[type] ?? "calendar";
}

export function primaryHarvestGroup(
  groups: HarvestGroupId[],
): HarvestGroupId {
  let best: HarvestGroupId = groups[0] ?? "event";
  let bestRank = HARVEST_GROUP_PRIORITY[best];
  for (const group of groups) {
    const rank = HARVEST_GROUP_PRIORITY[group];
    if (rank < bestRank) {
      best = group;
      bestRank = rank;
    }
  }
  return best;
}
