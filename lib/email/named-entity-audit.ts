/** Build the full named-entity set for extraction audit (entities + vendor/contract orgs). */

import { dedupeEntities, type DedupedEntity } from "@/lib/email/entity-dedup";
import { filterAuditEntities } from "@/lib/email/entity-grouping";
import type { EmailExtractionDocument } from "@/lib/email-analysis/schema";

export type NamedEntitySource = {
  type: string;
  value: string;
  context?: string | null;
  /** Also flagged in vendors[] — user should confirm role/classification. */
  vendorCandidate?: boolean;
};

function fieldString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function collectNamedEntitySources(
  document: EmailExtractionDocument,
): NamedEntitySource[] {
  const sources: NamedEntitySource[] = [];

  for (const entity of filterAuditEntities(document.entities ?? [])) {
    sources.push({
      type: entity.type,
      value: entity.value,
      context: entity.context,
    });
  }

  for (const vendor of document.vendors ?? []) {
    const name = fieldString(vendor.name);
    if (name) {
      sources.push({
        type: "org",
        value: name,
        context: vendor.source_quote ?? vendor.contact ?? vendor.email ?? vendor.phone,
        vendorCandidate: true,
      });
    }

    const phone = fieldString(vendor.phone);
    if (phone) {
      sources.push({
        type: "phone",
        value: phone,
        context: vendor.source_quote ?? name,
        vendorCandidate: true,
      });
    }
  }

  for (const contract of document.contracts ?? []) {
    const vendorName = fieldString(contract.vendor);
    if (vendorName) {
      sources.push({
        type: "org",
        value: vendorName,
        context: contract.source_quote,
        vendorCandidate: true,
      });
    }
  }

  return sources;
}

export type NamedEntityAuditRecord = DedupedEntity & {
  vendorCandidate?: boolean;
};

export function buildNamedEntityAuditRecords(
  document: EmailExtractionDocument,
): NamedEntityAuditRecord[] {
  const sources = collectNamedEntitySources(document);
  const vendorFlags = new Map<string, boolean>();

  for (const source of sources) {
    if (!source.vendorCandidate) continue;
    vendorFlags.set(`${source.type}:${source.value.toLowerCase()}`, true);
  }

  const deduped = dedupeEntities(
    sources.map((source) => ({
      type: source.type,
      value: source.value,
      context: source.context,
    })),
  );

  return deduped.map((entity) => ({
    ...entity,
    vendorCandidate: vendorFlags.has(`${entity.type}:${entity.value.toLowerCase()}`),
  }));
}
