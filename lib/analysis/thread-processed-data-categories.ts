import {
  EXTRACTION_DESTINATIONS,
  type ExtractionDestination,
} from "@/lib/email/extraction-routing";

/** Extraction panel destinations whose data can be removed per email thread. */
export type ThreadProcessedDataCategory = ExtractionDestination["id"];

export const THREAD_PROCESSED_DATA_CATEGORIES: ThreadProcessedDataCategory[] =
  EXTRACTION_DESTINATIONS.map((destination) => destination.id);

export const THREAD_PROCESSED_DATA_LABELS: Record<
  ThreadProcessedDataCategory,
  string
> = Object.fromEntries(
  EXTRACTION_DESTINATIONS.map((destination) => [
    destination.id,
    destination.title,
  ]),
) as Record<ThreadProcessedDataCategory, string>;

export type ThreadProcessedDataCounts = Record<
  ThreadProcessedDataCategory,
  number
>;

export function emptyThreadProcessedDataCounts(): ThreadProcessedDataCounts {
  return Object.fromEntries(
    THREAD_PROCESSED_DATA_CATEGORIES.map((category) => [category, 0]),
  ) as ThreadProcessedDataCounts;
}

export function shouldPurgeThreadExtractionArchive(
  selected: ThreadProcessedDataCategory[],
  categoriesWithData: ThreadProcessedDataCategory[],
): boolean {
  if (categoriesWithData.length === 0) return false;
  const selectedSet = new Set(selected);
  return categoriesWithData.every((category) => selectedSet.has(category));
}

/** Extraction document keys removed from the thread archive when a category is deleted. */
export const CATEGORY_EXTRACTION_FIELDS: Record<
  ThreadProcessedDataCategory,
  string[]
> = Object.fromEntries(
  EXTRACTION_DESTINATIONS.map((destination) => [
    destination.id,
    destination.fields,
  ]),
) as Record<ThreadProcessedDataCategory, string[]>;

export function extractionFieldsToStrip(
  categories: ThreadProcessedDataCategory[],
): string[] {
  const fields = new Set<string>();
  for (const category of categories) {
    for (const field of CATEGORY_EXTRACTION_FIELDS[category]) {
      fields.add(field);
    }
  }
  return [...fields];
}
