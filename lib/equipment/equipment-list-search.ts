/** Client-safe equipment list search helpers (no DB imports). */

export type EquipmentListSearchable = {
  id: string;
  displayName: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  location: string | null;
  drawingReference: string | null;
  notes: string | null;
  status: string;
  aliases: string[];
  componentKeywords: string[];
};

export function equipmentListSearchHaystack(
  item: EquipmentListSearchable,
): string {
  return [
    item.id,
    item.displayName,
    item.name,
    item.manufacturer,
    item.model,
    item.category,
    item.location,
    item.drawingReference,
    item.notes,
    item.status,
    ...item.aliases,
    ...item.componentKeywords,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function equipmentMatchesListSearch(
  item: EquipmentListSearchable,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return equipmentListSearchHaystack(item).includes(needle);
}
