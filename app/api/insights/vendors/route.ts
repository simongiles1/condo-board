export const runtime = "nodejs";

import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { contracts, invoices, vendors } from "@/lib/db/schema";

export async function GET() {
  const db = getDb();
  const vendorRows = await db.select().from(vendors).orderBy(asc(vendors.name));
  const contractRows = await db.select().from(contracts);
  const invoiceRows = await db.select().from(invoices);

  const vendorsWithDetails = vendorRows.map((vendor) => ({
    ...vendor,
    contact: vendor.contactJson ? JSON.parse(vendor.contactJson) : null,
    services: vendor.servicesJson ? JSON.parse(vendor.servicesJson) : null,
    contracts: contractRows.filter((c) => c.vendorId === vendor.id),
    invoices: invoiceRows.filter((i) => i.vendorId === vendor.id),
  }));

  return NextResponse.json({ vendors: vendorsWithDetails });
}
