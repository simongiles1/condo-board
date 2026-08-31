/** Client-safe Gemini / DeepSeek token list prices and intro discounts. */

export type ModelTokenPricing = {
  input: number;
  output: number;
};

/** List (post-intro) USD per 1M tokens. */
export const MODEL_LIST_PRICING_USD_PER_MILLION: Record<
  string,
  ModelTokenPricing
> = {
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-flash-live-preview": { input: 0.75, output: 4.5 },
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 1.5, output: 7.5 },
  "gemini-3.7-flash": { input: 1.5, output: 7.5 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
};

/**
 * Gemini 3.6 / 3.7 Flash 50% intro pricing is billed through the end of
 * 2026-12-31 (UTC): $0.75 / $3.75 vs list $1.50 / $7.50. After this instant,
 * list prices apply.
 */
export const GEMINI_FLASH_INTRO_UNTIL_MS = Date.parse(
  "2027-01-01T00:00:00.000Z",
);

const GEMINI_FLASH_INTRO_PRICING: Record<string, ModelTokenPricing> = {
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};

const MODEL_PRICING_ALIASES: Array<{
  match: RegExp;
  id: string;
}> = [
  { match: /gemini-3\.7-flash/i, id: "gemini-3.7-flash" },
  { match: /gemini-3\.6-flash/i, id: "gemini-3.6-flash" },
  { match: /gemini-3\.5-flash/i, id: "gemini-3.5-flash" },
  { match: /gemini-3\.1-pro/i, id: "gemini-3.1-pro-preview" },
  { match: /gemini-3\.1-flash-live-preview/i, id: "gemini-3.1-flash-live-preview" },
  { match: /gemini-3\.1-flash-lite/i, id: "gemini-3.1-flash-lite" },
  { match: /gemini-2\.5-flash/i, id: "gemini-2.5-flash" },
  { match: /gemini-2\.0-flash-lite/i, id: "gemini-2.0-flash-lite" },
  { match: /gemini-2\.0-flash/i, id: "gemini-2.0-flash" },
  { match: /gemini-2\.5-pro/i, id: "gemini-2.5-pro" },
  { match: /deepseek-v4-flash/i, id: "deepseek-v4-flash" },
];

export function geminiFlashIntroPricingActive(nowMs = Date.now()): boolean {
  return nowMs < GEMINI_FLASH_INTRO_UNTIL_MS;
}

export function resolveListedModelId(modelName: string): string | null {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized) return null;
  if (MODEL_LIST_PRICING_USD_PER_MILLION[normalized]) return normalized;
  for (const alias of MODEL_PRICING_ALIASES) {
    if (alias.match.test(normalized)) return alias.id;
  }
  return null;
}

export function listPricingForModel(modelName: string): ModelTokenPricing | null {
  const id = resolveListedModelId(modelName);
  if (!id) return null;
  return MODEL_LIST_PRICING_USD_PER_MILLION[id] ?? null;
}

/** Effective billed rate: intro discount when active, otherwise list. */
export function billedPricingForModel(
  modelName: string,
  nowMs = Date.now(),
): ModelTokenPricing | null {
  const id = resolveListedModelId(modelName);
  if (!id) return null;
  const list = MODEL_LIST_PRICING_USD_PER_MILLION[id];
  if (!list) return null;
  if (geminiFlashIntroPricingActive(nowMs) && GEMINI_FLASH_INTRO_PRICING[id]) {
    return GEMINI_FLASH_INTRO_PRICING[id]!;
  }
  return list;
}

export function formatUsdPerMillion(value: number): string {
  const cents = value * 100;
  const decimals = Number.isInteger(cents) ? 2 : 3;
  return value.toFixed(decimals);
}
