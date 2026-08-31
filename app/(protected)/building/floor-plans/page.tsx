export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { FloorPlansClient } from "./FloorPlansClient";
import { loadFloorPlansPayload } from "@/lib/building/floor-plans";

export default async function FloorPlansPage() {
  const initial = await loadFloorPlansPayload();
  return <FloorPlansClient initial={initial} />;
}
