/** Shared equipment classification helpers for extraction, persistence, and UI. */

export type EquipmentKind = "equipment" | "manufacturer" | "component";
export type EquipmentSignificance = "major" | "minor";

export type EquipmentClassification = {
  kind?: EquipmentKind | string | null;
  significance?: EquipmentSignificance | string | null;
  canonicalId?: string | null;
};

export function normalizeEquipmentKind(
  kind: EquipmentClassification["kind"],
): EquipmentKind {
  if (kind === "manufacturer" || kind === "component") return kind;
  return "equipment";
}

export function normalizeEquipmentSignificance(
  significance: EquipmentClassification["significance"],
): EquipmentSignificance {
  return significance === "minor" ? "minor" : "major";
}

/** Whether an asset row is a duplicate pointer merged into another canonical asset. */
export function isEquipmentDuplicatePointer(asset: EquipmentClassification): boolean {
  return Boolean(asset.canonicalId);
}

/** Default Insights/Building view: major physical equipment only, not duplicate pointers. */
export function isPrimaryEquipmentView(asset: EquipmentClassification): boolean {
  if (isEquipmentDuplicatePointer(asset)) return false;
  return (
    normalizeEquipmentKind(asset.kind) === "equipment" &&
    normalizeEquipmentSignificance(asset.significance) === "major"
  );
}

export function filterClassifiedEquipment<T extends EquipmentClassification>(
  rows: T[],
  showAll: boolean,
): T[] {
  if (showAll) {
    return rows.filter((row) => !isEquipmentDuplicatePointer(row));
  }
  return rows.filter((row) => isPrimaryEquipmentView(row));
}

export function equipmentClassificationLabel(asset: EquipmentClassification): string {
  const kind = normalizeEquipmentKind(asset.kind);
  const significance = normalizeEquipmentSignificance(asset.significance);
  if (kind === "equipment" && significance === "major") return "Major equipment";
  if (kind === "equipment" && significance === "minor") return "Minor equipment";
  if (kind === "component") return "Component";
  if (kind === "manufacturer") return "Manufacturer";
  return `${kind} · ${significance}`;
}
