const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type DeepSeekBalanceInfo = {
  currency: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
};

export type DeepSeekBalanceSnapshot = {
  isAvailable: boolean;
  balances: DeepSeekBalanceInfo[];
  error?: string;
};

type DeepSeekBalanceApiResponse = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
  error?: { message?: string };
};

function deepSeekBaseUrl(): string {
  const configured = process.env.DEEPSEEK_API_BASE_URL?.trim();
  return (configured || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
}

function parseBalanceAmount(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function pickPreferredDeepSeekBalance(
  balances: DeepSeekBalanceInfo[],
): DeepSeekBalanceInfo | null {
  if (balances.length === 0) return null;
  return (
    balances.find((balance) => balance.currency.toUpperCase() === "USD") ??
    balances[0] ??
    null
  );
}

export async function fetchDeepSeekBalance(): Promise<DeepSeekBalanceSnapshot> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return {
      isAvailable: false,
      balances: [],
      error: "DEEPSEEK_API_KEY is not configured.",
    };
  }

  try {
    const response = await fetch(`${deepSeekBaseUrl()}/user/balance`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    const payload = (await response.json()) as DeepSeekBalanceApiResponse;
    if (!response.ok) {
      return {
        isAvailable: false,
        balances: [],
        error: payload.error?.message ?? "Could not load DeepSeek balance.",
      };
    }

    const balances = (payload.balance_infos ?? [])
      .map((entry) => ({
        currency: entry.currency?.trim() || "USD",
        totalBalance: parseBalanceAmount(entry.total_balance),
        grantedBalance: parseBalanceAmount(entry.granted_balance),
        toppedUpBalance: parseBalanceAmount(entry.topped_up_balance),
      }))
      .filter((entry) => entry.currency.length > 0);

    return {
      isAvailable: Boolean(payload.is_available),
      balances,
    };
  } catch (error) {
    return {
      isAvailable: false,
      balances: [],
      error:
        error instanceof Error ? error.message : "Could not load DeepSeek balance.",
    };
  }
}
