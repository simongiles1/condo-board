export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  createFloorPlanFromSplitUpload,
  createFloorPlanFromUpload,
  loadFloorPlansPayload,
} from "@/lib/building/floor-plans";
import {
  parseFloorNumber,
  parseFloorPlanName,
} from "@/lib/building/floor-plan-shared";
import { assertLooksLikePdf } from "@/lib/pdf/pdf-bytes";

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Floor plan request failed.";
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const payload = await loadFloorPlansPayload();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[floor-plans:get]", error);
    return NextResponse.json(
      { error: "Could not load floor plans." },
      { status: 500 },
    );
  }
}

function isPdfUpload(file: File): boolean {
  const type = file.type || "";
  const filename = file.name || "";
  return (
    !type ||
    type === "application/pdf" ||
    filename.toLowerCase().endsWith(".pdf")
  );
}

function pdfFile(form: FormData, key: string): File | null {
  const value = form.get(key);
  if (!(value instanceof File)) return null;
  if (value.size === 0) return null;
  return value;
}

async function readUploadPdfBytes(file: File, label: string): Promise<Uint8Array> {
  if (!isPdfUpload(file)) {
    throw new Error(`${label} must be a PDF file.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) {
    throw new Error(
      `${label} upload was incomplete (${bytes.byteLength} of ${file.size} bytes received).`,
    );
  }
  if (bytes.byteLength > 80 * 1024 * 1024) {
    throw new Error(`${label} PDF is larger than 80 MB.`);
  }
  assertLooksLikePdf(bytes, label);
  return bytes;
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const form = await request.formData();
    const familyId =
      typeof form.get("familyId") === "string"
        ? String(form.get("familyId")).trim()
        : "";
    const name =
      typeof form.get("name") === "string" ? String(form.get("name")) : "";
    const notes =
      typeof form.get("notes") === "string" ? String(form.get("notes")) : "";
    if (!familyId) {
      return NextResponse.json({ error: "familyId is required." }, { status: 400 });
    }

    const westFile = pdfFile(form, "westFile");
    const eastFile = pdfFile(form, "eastFile");
    const file = pdfFile(form, "file");

    if (westFile && eastFile) {
      const fallbackLabel =
        name ||
        westFile.name.replace(/\.pdf$/i, "") ||
        eastFile.name.replace(/\.pdf$/i, "") ||
        "Untitled";
      const parsed = parseFloorPlanName(fallbackLabel);
      const floorNumber =
        parseFloorNumber(form.get("floorNumber")) ?? parsed.floorNumber;
      if (floorNumber == null) {
        return NextResponse.json(
          { error: "Floor number is required." },
          { status: 400 },
        );
      }
      const [westBytes, eastBytes] = await Promise.all([
        readUploadPdfBytes(westFile, "West"),
        readUploadPdfBytes(eastFile, "East"),
      ]);
      const plan = await createFloorPlanFromSplitUpload({
        familyId,
        name: parsed.name || fallbackLabel,
        floorNumber,
        notes,
        westBytes,
        eastBytes,
      });
      return NextResponse.json(plan, { status: 201 });
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    }
    const bytes = await readUploadPdfBytes(file, "PDF");
    const fallbackLabel = name || file.name.replace(/\.pdf$/i, "") || "Untitled";
    const parsed = parseFloorPlanName(fallbackLabel);
    const floorNumber =
      parseFloorNumber(form.get("floorNumber")) ?? parsed.floorNumber;
    if (floorNumber == null) {
      return NextResponse.json(
        { error: "Floor number is required." },
        { status: 400 },
      );
    }
    const plan = await createFloorPlanFromUpload({
      familyId,
      name: parsed.name || fallbackLabel,
      floorNumber,
      notes,
      bytes,
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error("[floor-plans:post]", error);
    return errorResponse(error);
  }
}
