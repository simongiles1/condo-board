import { NextResponse } from "next/server";

import { isRemoteSourcePullEnabled } from "@/lib/dev/remote-source-pull";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ enabled: false }, { status: 404 });
  }

  return NextResponse.json({
    enabled: isRemoteSourcePullEnabled(),
  });
}
