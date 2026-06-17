/** Group related people, orgs, and phones for extraction audit display. */

import {
  entitiesMatch,
  normalizeOrgName,
  normalizePersonName,
  type DedupedEntity,
} from "@/lib/email/entity-dedup";
import { composeLinkContext } from "@/lib/entities/entity-context-snippet";

export const AUDIT_ENTITY_TYPES = new Set(["person", "org", "phone", "unit"]);

export type EntityProvenance = {
  emailId: string | null;
  emailFrom: string | null;
  emailSubject: string | null;
};

export type EntityWithProvenance = DedupedEntity & {
  sources: EntityProvenance[];
  vendorCandidate?: boolean;
  mentionIds: string[];
};

export type ContactAuditGroup = {
  key: string;
  person?: EntityWithProvenance;
  org?: EntityWithProvenance;
  phone?: EntityWithProvenance;
  unit?: EntityWithProvenance;
  linkContext?: string;
  vendorCandidate?: boolean;
};

export type EntityAuditInput = {
  type: string;
  value: string;
  contexts: string[];
  sourceEmailId?: string | null;
  sourceEmailFrom?: string | null;
  sourceEmailSubject?: string | null;
  vendorCandidate?: boolean;
  mentionId?: string;
};

function fieldString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isAuditEntityType(type: string): boolean {
  return AUDIT_ENTITY_TYPES.has(type);
}

export function filterAuditEntities(
  entities: Array<{ type: string; value: string; context?: string | null }>,
): Array<{ type: string; value: string; context?: string | null }> {
  return entities.filter((entity) => isAuditEntityType(entity.type));
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(/[\w.+-]+@[\w.-]+\.\w+/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function domainRelatesToOrg(domain: string, orgValue: string): boolean {
  if (!domain) return false;
  const orgNorm = normalizeOrgName(orgValue).replace(/\s+/g, "");
  const domainStem = domain
    .replace(/\.(com|ca|org|net|io)$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  if (!orgNorm || !domainStem) return false;
  return orgNorm.includes(domainStem) || domainStem.includes(orgNorm);
}

function emailBelongsToPerson(email: string, personValue: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return false;
  const normalized = normalizePersonName(personValue);
  if (local === normalized.replace(/\s+/g, "")) return true;
  const first = normalized.split(/\s+/)[0];
  return local === first || normalized.startsWith(`${local} `);
}

function isStrongLinkContext(context: string): boolean {
  if (extractEmailsFromText(context).length > 0) return true;
  const lower = context.toLowerCase();
  if (/from:|^cc:|>|<[^>]+@/.test(lower)) return true;
  return false;
}

function clusterKeys(entity: EntityAuditInput): string[] {
  const keys = new Set<string>();

  if (entity.type === "phone") {
    for (const context of entity.contexts) {
      if (isStrongLinkContext(context)) {
        keys.add(`ctx:${context.toLowerCase().trim()}`);
      }
    }
    return [...keys];
  }

  for (const context of entity.contexts) {
    if (isStrongLinkContext(context)) {
      keys.add(`ctx:${context.toLowerCase().trim()}`);
    }

    for (const email of extractEmailsFromText(context)) {
      if (entity.type === "person" && !emailBelongsToPerson(email, entity.value)) {
        continue;
      }
      keys.add(`email:${email}`);
      const domain = extractDomain(email);
      if (domain && entity.type !== "person") {
        keys.add(`domain:${domain}`);
      }
    }
  }

  const fromAddress = fieldString(entity.sourceEmailFrom);
  if (fromAddress) {
    if (entity.type !== "person" || emailBelongsToPerson(fromAddress, entity.value)) {
      keys.add(`email:${fromAddress.toLowerCase()}`);
      const domain = extractDomain(fromAddress);
      if (domain && entity.type !== "person") {
        keys.add(`domain:${domain}`);
      }
    }
  }

  if (entity.type === "org") {
    for (const context of entity.contexts) {
      for (const email of extractEmailsFromText(context)) {
        if (domainRelatesToOrg(extractDomain(email), entity.value)) {
          keys.add(`domain:${extractDomain(email)}`);
        }
      }
    }
  }

  return [...keys];
}

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

function mergeProvenance(
  existing: EntityProvenance[],
  incoming: EntityProvenance,
): EntityProvenance[] {
  const key = `${incoming.emailId ?? ""}|${incoming.emailFrom ?? ""}|${incoming.emailSubject ?? ""}`;
  if (
    existing.some(
      (source) =>
        `${source.emailId ?? ""}|${source.emailFrom ?? ""}|${source.emailSubject ?? ""}` ===
        key,
    )
  ) {
    return existing;
  }
  return [...existing, incoming];
}

function mergeEntityFields(
  existing: EntityWithProvenance | undefined,
  incoming: EntityAuditInput,
): EntityWithProvenance {
  const provenance: EntityProvenance = {
    emailId: incoming.sourceEmailId ?? null,
    emailFrom: incoming.sourceEmailFrom ?? null,
    emailSubject: incoming.sourceEmailSubject ?? null,
  };

  if (!existing) {
    return {
      type: incoming.type,
      value: incoming.value,
      contexts: [...incoming.contexts],
      sources: [provenance],
      vendorCandidate: incoming.vendorCandidate,
      mentionIds: incoming.mentionId ? [incoming.mentionId] : [],
    };
  }

  const contexts = new Set([...existing.contexts, ...incoming.contexts]);
  const mentionIds = new Set(existing.mentionIds);
  if (incoming.mentionId) mentionIds.add(incoming.mentionId);

  return {
    type: existing.type,
    value:
      incoming.value.length > existing.value.length ? incoming.value : existing.value,
    contexts: [...contexts],
    sources: mergeProvenance(existing.sources, provenance),
    vendorCandidate: existing.vendorCandidate || incoming.vendorCandidate,
    mentionIds: [...mentionIds],
  };
}

function pickLinkContext(entities: EntityAuditInput[]): string | undefined {
  const contexts: string[] = [];

  for (const entity of entities) {
    for (const context of entity.contexts) {
      if (context.trim()) contexts.push(context.trim());
    }
  }

  return composeLinkContext(contexts);
}

function mergeSameTypeInCluster(
  cluster: EntityAuditInput[],
): EntityWithProvenance[] {
  const merged: EntityWithProvenance[] = [];

  for (const entity of cluster) {
    const existingIndex = merged.findIndex((entry) =>
      entitiesMatch(entry, { type: entity.type, value: entity.value }),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = mergeEntityFields(merged[existingIndex], entity);
      continue;
    }

    merged.push(mergeEntityFields(undefined, entity));
  }

  return merged;
}

function mergeProvenanceEntities(
  existing: EntityWithProvenance | undefined,
  incoming: EntityWithProvenance | undefined,
): EntityWithProvenance | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (!entitiesMatch(existing, incoming)) return existing;

  const contexts = new Set([...existing.contexts, ...incoming.contexts]);
  let sources = [...existing.sources];
  for (const source of incoming.sources) {
    sources = mergeProvenance(sources, source);
  }

  return {
    type: existing.type,
    value:
      incoming.value.length > existing.value.length ? incoming.value : existing.value,
    contexts: [...contexts],
    sources,
    vendorCandidate: existing.vendorCandidate || incoming.vendorCandidate,
    mentionIds: [...new Set([...existing.mentionIds, ...incoming.mentionIds])],
  };
}

function contactGroupsOverlap(
  a: ContactAuditGroup,
  b: ContactAuditGroup,
): boolean {
  const pairs: Array<
    [EntityWithProvenance | undefined, EntityWithProvenance | undefined]
  > = [
    [a.person, b.person],
    [a.org, b.org],
    [a.phone, b.phone],
    [a.unit, b.unit],
  ];

  return pairs.some(
    ([left, right]) => left && right && entitiesMatch(left, right),
  );
}

function mergeContactGroups(
  a: ContactAuditGroup,
  b: ContactAuditGroup,
): ContactAuditGroup {
  return {
    key: "",
    person: mergeProvenanceEntities(a.person, b.person),
    org: mergeProvenanceEntities(a.org, b.org),
    phone: mergeProvenanceEntities(a.phone, b.phone),
    unit: mergeProvenanceEntities(a.unit, b.unit),
    linkContext: a.linkContext ?? b.linkContext,
    vendorCandidate: a.vendorCandidate || b.vendorCandidate,
  };
}

function buildGroupKey(group: ContactAuditGroup): string {
  return [
    group.person ? `person:${group.person.value}` : null,
    group.org ? `org:${group.org.value}` : null,
    group.phone ? `phone:${group.phone.value}` : null,
    group.unit ? `unit:${group.unit.value}` : null,
  ]
    .filter(Boolean)
    .join("|");
}

function assignUniqueGroupKeys(groups: ContactAuditGroup[]): ContactAuditGroup[] {
  const keyCounts = new Map<string, number>();

  return groups.map((group) => {
    const base = buildGroupKey(group) || "contact";
    const seen = keyCounts.get(base) ?? 0;
    keyCounts.set(base, seen + 1);
    return {
      ...group,
      key: seen === 0 ? base : `${base}#${seen}`,
    };
  });
}

function consolidateContactGroups(
  groups: ContactAuditGroup[],
): ContactAuditGroup[] {
  const merged: ContactAuditGroup[] = [];

  for (const group of groups) {
    const matchIndex = merged.findIndex((existing) =>
      contactGroupsOverlap(existing, group),
    );

    if (matchIndex === -1) {
      merged.push({ ...group });
      continue;
    }

    merged[matchIndex] = mergeContactGroups(merged[matchIndex], group);
  }

  return assignUniqueGroupKeys(merged);
}

/** Cluster person/org/phone/unit rows that clearly belong to the same contact. */
export function groupEntitiesForAudit(
  inputs: EntityAuditInput[],
): ContactAuditGroup[] {
  const auditInputs = inputs.filter((input) => isAuditEntityType(input.type));
  if (auditInputs.length === 0) return [];

  const uf = new UnionFind(auditInputs.length);
  const keyToIndex = new Map<string, number>();

  for (let index = 0; index < auditInputs.length; index += 1) {
    for (const key of clusterKeys(auditInputs[index])) {
      const existing = keyToIndex.get(key);
      if (existing !== undefined) {
        uf.union(existing, index);
      } else {
        keyToIndex.set(key, index);
      }
    }
  }

  const clusters = new Map<number, EntityAuditInput[]>();
  for (let index = 0; index < auditInputs.length; index += 1) {
    const root = uf.find(index);
    const bucket = clusters.get(root) ?? [];
    bucket.push(auditInputs[index]);
    clusters.set(root, bucket);
  }

  const groups: ContactAuditGroup[] = [];

  for (const cluster of clusters.values()) {
    const merged = mergeSameTypeInCluster(cluster);
    const group: ContactAuditGroup = {
      key: merged.map((entity) => `${entity.type}:${entity.value}`).join("|"),
      linkContext: pickLinkContext(cluster),
    };

    for (const entity of merged) {
      switch (entity.type) {
        case "person":
          group.person = entity;
          break;
        case "org":
          group.org = entity;
          break;
        case "phone":
          group.phone = entity;
          break;
        case "unit":
          group.unit = entity;
          break;
      }
    }

    groups.push(group);
  }

  for (const group of groups) {
    group.vendorCandidate = Boolean(
      group.person?.vendorCandidate ||
        group.org?.vendorCandidate ||
        group.phone?.vendorCandidate ||
        group.unit?.vendorCandidate,
    );
  }

  const consolidated = consolidateContactGroups(groups);

  consolidated.sort((a, b) => {
    const aLabel =
      a.person?.value ?? a.org?.value ?? a.phone?.value ?? a.unit?.value ?? "";
    const bLabel =
      b.person?.value ?? b.org?.value ?? b.phone?.value ?? b.unit?.value ?? "";
    return aLabel.localeCompare(bLabel);
  });

  return consolidated;
}

export function formatProvenanceLabel(source: EntityProvenance): string {
  if (source.emailFrom) {
    const local = source.emailFrom.split("@")[0];
    return local ? local : source.emailFrom;
  }
  if (source.emailSubject) {
    return source.emailSubject.length > 36
      ? `${source.emailSubject.slice(0, 33)}…`
      : source.emailSubject;
  }
  return "This email";
}
