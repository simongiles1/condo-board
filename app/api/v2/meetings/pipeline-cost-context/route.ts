import { NextResponse } from "next/server";

import {
  fetchDeepSeekBalance,
  pickPreferredDeepSeekBalance,
} from "@/lib/deepseek/balance";
import { loadPipelineSpendEstimates } from "@/lib/meeting-v2/pipeline-spend-estimates";

export async function GET() {
  try {
    const [balanceSnapshot, estimates] = await Promise.all([
      fetchDeepSeekBalance(),
      loadPipelineSpendEstimates(),
    ]);
    const preferredBalance = pickPreferredDeepSeekBalance(balanceSnapshot.balances);

    return NextResponse.json(
      {
        balance: {
          isAvailable: balanceSnapshot.isAvailable,
          error: balanceSnapshot.error,
          currency: preferredBalance?.currency ?? "USD",
          totalBalance: preferredBalance?.totalBalance ?? null,
          grantedBalance: preferredBalance?.grantedBalance ?? null,
          toppedUpBalance: preferredBalance?.toppedUpBalance ?? null,
        },
        estimates,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[v2/pipeline-cost-context]", error);
    return NextResponse.json(
      { error: "Failed to load pipeline cost context" },
      { status: 500 },
    );
  }
}
