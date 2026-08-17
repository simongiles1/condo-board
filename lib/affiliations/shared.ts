/** Shared types for person ↔ organization affiliations. */

export type AffiliationRelationType =
  | "employed_at"
  | "represents"
  | "board_of";

export type AffiliationStatus = "pending" | "approved" | "denied";

export type AffiliationSource =
  | "domain_prior"
  | "cooccurrence"
  | "ai_adjudicated"
  | "manual"
  | "legacy_bridge";

export type AffiliationConfidence = "high" | "medium" | "low";

export type AffiliationEvidence = {
  emailIds?: string[];
  domain?: string;
  companyNames?: string[];
  linkedOrganizationName?: string;
  rationale?: string;
  candidateOrganizationIds?: string[];
  scores?: Record<string, number>;
  aiAction?: string;
  aiPreferred?: boolean;
};

export type AffiliationRow = {
  id: string;
  personId: string;
  organizationId: string;
  organizationKey: string;
  organizationName: string | null;
  organizationEmail: string | null;
  relationType: AffiliationRelationType;
  status: AffiliationStatus;
  source: AffiliationSource;
  confidence: AffiliationConfidence;
  evidence: AffiliationEvidence;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

export function parseAffiliationEvidence(raw: string | null | undefined): AffiliationEvidence {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as AffiliationEvidence;
  } catch {
    return {};
  }
}

export function serializeAffiliationEvidence(evidence: AffiliationEvidence): string {
  return JSON.stringify(evidence ?? {});
}
