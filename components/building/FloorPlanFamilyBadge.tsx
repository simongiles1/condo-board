const FAMILY_BADGE_COLORS = [
  "bg-violet-50 text-violet-700 ring-violet-200",
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-amber-50 text-amber-700 ring-amber-200",
  "bg-rose-50 text-rose-700 ring-rose-200",
  "bg-teal-50 text-teal-700 ring-teal-200",
  "bg-indigo-50 text-indigo-700 ring-indigo-200",
] as const;

export function familyBadgeColor(familyIndex: number): string {
  return FAMILY_BADGE_COLORS[familyIndex % FAMILY_BADGE_COLORS.length];
}

export function familyBadgeColorForId(
  familyId: string,
  families: ReadonlyArray<{ id: string }>,
): string {
  const index = families.findIndex((family) => family.id === familyId);
  return familyBadgeColor(index >= 0 ? index : 0);
}

export function FloorPlanFamilyBadge({
  name,
  colorClass,
}: {
  name: string;
  colorClass: string;
}) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${colorClass}`}
    >
      {name}
    </span>
  );
}
