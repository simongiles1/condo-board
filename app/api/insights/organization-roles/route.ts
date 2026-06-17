export const runtime = "nodejs";

import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { organizationRoleDefinitions } from "@/lib/db/schema";
import {
  buildUniqueOrganizationRoleId,
  fetchCustomOrganizationRoles,
  getValidOrganizationRoleIds,
} from "@/lib/vendors/fetch-organization-roles";

type CreatePayload = {
  label?: string;
};

export async function GET() {
  const roles = await fetchCustomOrganizationRoles();
  return NextResponse.json({ roles });
}

export async function POST(request: Request) {
  const db = getDb();

  try {
    const body = (await request.json()) as CreatePayload;
    const label = body.label?.trim();

    if (!label) {
      return NextResponse.json({ error: "Role label is required" }, { status: 400 });
    }

    const allRows = await db
      .select()
      .from(organizationRoleDefinitions)
      .orderBy(asc(organizationRoleDefinitions.label));

    const duplicateLabel = allRows.find(
      (row) => row.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (duplicateLabel) {
      return NextResponse.json({
        role: { id: duplicateLabel.id, label: duplicateLabel.label },
      });
    }

    const takenIds = await getValidOrganizationRoleIds();
    const id = buildUniqueOrganizationRoleId(label, takenIds);
    if (!id) {
      return NextResponse.json(
        { error: "Role label must include letters or numbers" },
        { status: 400 },
      );
    }

    const createdAt = new Date().toISOString();
    await db.insert(organizationRoleDefinitions).values({
      id,
      label,
      createdAt,
    });

    return NextResponse.json({
      role: { id, label },
    });
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload" }, { status: 400 });
  }
}
