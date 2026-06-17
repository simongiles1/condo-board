export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { vendors } from "@/lib/db/schema";
import { getValidOrganizationRoleIds } from "@/lib/vendors/fetch-organization-roles";
import { isValidOrganizationRole } from "@/lib/vendors/organization-roles";

type Payload = {
  name?: string;
  organizationRole?: string;
  reviewStatus?: "pending" | "approved";
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDb();

  try {
    const body = (await request.json()) as Payload;
    const [existing] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : existing.name;
    const validRoleIds = await getValidOrganizationRoleIds();
    const organizationRole =
      typeof body.organizationRole === "string" &&
      isValidOrganizationRole(body.organizationRole, validRoleIds)
        ? body.organizationRole
        : existing.organizationRole;
    const reviewStatus =
      body.reviewStatus === "approved" || body.reviewStatus === "pending"
        ? body.reviewStatus
        : existing.reviewStatus;

    const [updated] = await db
      .update(vendors)
      .set({
        name,
        organizationRole,
        reviewStatus,
      })
      .where(eq(vendors.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload" }, {
      status: 400,
    });
  }
}
