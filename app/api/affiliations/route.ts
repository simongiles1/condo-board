export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { adjudicateAmbiguousAffiliations } from "@/lib/affiliations/adjudicate";
import {
  acceptAffiliationCandidate,
  approveAffiliation,
  createManualAffiliation,
  denyAffiliation,
  rejectAffiliationCandidate,
} from "@/lib/affiliations/apply";
import { bridgeLegacyLinkedOrganizationNames } from "@/lib/affiliations/legacy-bridge";
import {
  getAffiliationStats,
  loadAffiliationsForPerson,
} from "@/lib/affiliations/load";
import { loadAffiliationMatchingQueue } from "@/lib/affiliations/queue";
import { proposePersonOrganizationAffiliations } from "@/lib/affiliations/propose";
import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  loadActiveOrganizationEntities,
  syncOrganizationEntitiesFromFingerprints,
} from "@/lib/organizations/registry-sync";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "person";
  const personId = url.searchParams.get("personId")?.trim() ?? "";

  try {
    if (view === "stats") {
      const stats = await getAffiliationStats();
      return NextResponse.json({ view: "stats", stats });
    }

    if (view === "queue") {
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number(limitRaw) : 2000;
      const queue = await loadAffiliationMatchingQueue({
        limitPersons: Number.isFinite(limit) ? limit : 2000,
      });
      return NextResponse.json({ view: "queue", ...queue });
    }

    if (view === "organizations") {
      await syncOrganizationEntitiesFromFingerprints();
      const organizations = await loadActiveOrganizationEntities();
      return NextResponse.json({
        view: "organizations",
        organizations: organizations.map((o) => ({
          id: o.id,
          identityKey: o.identityKey,
          displayName: o.name?.trim() || o.email || o.identityKey,
          name: o.name,
          email: o.email,
          website: o.website,
          organizationRole: o.organizationRole,
        })),
      });
    }

    if (!personId) {
      return NextResponse.json(
        { error: "personId is required for view=person." },
        { status: 400 },
      );
    }

    const affiliations = await loadAffiliationsForPerson(personId);
    const stats = await getAffiliationStats();
    return NextResponse.json({ view: "person", personId, affiliations, stats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load affiliations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: {
    action?: string;
    affiliationId?: string;
    personId?: string;
    organizationId?: string;
    relationType?: string;
    personIds?: string[];
    modelId?: string | null;
    limit?: number;
    source?: string;
    confidence?: string;
    evidence?: Record<string, unknown>;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action?.trim() || "propose";

  try {
    if (action === "sync_orgs") {
      const result = await syncOrganizationEntitiesFromFingerprints({
        limit: body.limit ?? 2000,
      });
      return NextResponse.json({
        ok: true,
        created: result.created,
        updated: result.updated,
        organizationCount: result.organizations.length,
      });
    }

    if (action === "propose") {
      const result = await proposePersonOrganizationAffiliations({
        limitPersons: body.limit ?? 2000,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "adjudicate") {
      let personIds = Array.isArray(body.personIds) ? body.personIds : [];
      if (personIds.length === 0) {
        const proposed = await proposePersonOrganizationAffiliations({
          limitPersons: body.limit ?? 2000,
        });
        personIds = proposed.ambiguousPersonIds;
      }
      const result = await adjudicateAmbiguousAffiliations({
        personIds,
        modelId: body.modelId ?? null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "bridge_legacy") {
      const result = await bridgeLegacyLinkedOrganizationNames({
        limit: body.limit ?? 2000,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "approve") {
      const result = await approveAffiliation({
        affiliationId: body.affiliationId ?? "",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "deny") {
      const result = await denyAffiliation({
        affiliationId: body.affiliationId ?? "",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "accept_candidate") {
      const result = await acceptAffiliationCandidate({
        personId: body.personId ?? "",
        organizationId: body.organizationId ?? "",
        affiliationId: body.affiliationId,
        source:
          body.source === "domain_prior" ||
          body.source === "cooccurrence" ||
          body.source === "ai_adjudicated" ||
          body.source === "manual" ||
          body.source === "legacy_bridge"
            ? body.source
            : undefined,
        confidence:
          body.confidence === "high" ||
          body.confidence === "medium" ||
          body.confidence === "low"
            ? body.confidence
            : undefined,
        evidence: body.evidence,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, id: result.id });
    }

    if (action === "reject_candidate") {
      const result = await rejectAffiliationCandidate({
        personId: body.personId ?? "",
        organizationId: body.organizationId ?? "",
        affiliationId: body.affiliationId,
        source:
          body.source === "domain_prior" ||
          body.source === "cooccurrence" ||
          body.source === "ai_adjudicated" ||
          body.source === "manual" ||
          body.source === "legacy_bridge"
            ? body.source
            : undefined,
        confidence:
          body.confidence === "high" ||
          body.confidence === "medium" ||
          body.confidence === "low"
            ? body.confidence
            : undefined,
        evidence: body.evidence,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, id: result.id });
    }

    if (action === "manual_link") {
      const result = await createManualAffiliation({
        personId: body.personId ?? "",
        organizationId: body.organizationId ?? "",
        relationType:
          body.relationType === "represents" || body.relationType === "board_of"
            ? body.relationType
            : "employed_at",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, id: result.id });
    }

    return NextResponse.json(
      {
        error:
          "Unsupported action. Use propose | adjudicate | bridge_legacy | approve | deny | accept_candidate | reject_candidate | manual_link | sync_orgs.",
      },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Affiliation action failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
