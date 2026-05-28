export const MODEL_SETTINGS_STORAGE_KEY = "condo-board-model-settings";

export const AVAILABLE_GEMINI_MODELS = [
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.5,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: "gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash Live Preview",
    inputPricePerMillion: 0.75,
    outputPricePerMillion: 4.5,
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 9,
  },
] as const;

export type GeminiModelId = (typeof AVAILABLE_GEMINI_MODELS)[number]["id"];

export type ModelSettings = {
  mainMinutes: GeminiModelId;
  mainTodos: GeminiModelId;
  omissionsMinutes: GeminiModelId;
  omissionsTodos: GeminiModelId;
};

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  mainMinutes: "gemini-3.1-flash-lite",
  mainTodos: "gemini-3.1-flash-lite",
  omissionsMinutes: "gemini-3.1-flash-lite",
  omissionsTodos: "gemini-3.1-flash-lite",
};

const ALLOWED_MODEL_IDS = new Set<string>(
  AVAILABLE_GEMINI_MODELS.map((model) => model.id),
);

export function isAllowedGeminiModel(
  value: unknown,
): value is GeminiModelId {
  return typeof value === "string" && ALLOWED_MODEL_IDS.has(value);
}

export function normalizeModelSettings(
  input: Partial<ModelSettings> | null | undefined,
): ModelSettings {
  return {
    mainMinutes: isAllowedGeminiModel(input?.mainMinutes)
      ? input.mainMinutes
      : DEFAULT_MODEL_SETTINGS.mainMinutes,
    mainTodos: isAllowedGeminiModel(input?.mainTodos)
      ? input.mainTodos
      : DEFAULT_MODEL_SETTINGS.mainTodos,
    omissionsMinutes: isAllowedGeminiModel(input?.omissionsMinutes)
      ? input.omissionsMinutes
      : DEFAULT_MODEL_SETTINGS.omissionsMinutes,
    omissionsTodos: isAllowedGeminiModel(input?.omissionsTodos)
      ? input.omissionsTodos
      : DEFAULT_MODEL_SETTINGS.omissionsTodos,
  };
}

export function loadModelSettings(): ModelSettings {
  if (typeof window === "undefined") return DEFAULT_MODEL_SETTINGS;

  try {
    const raw = localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_MODEL_SETTINGS;
    return normalizeModelSettings(JSON.parse(raw) as Partial<ModelSettings>);
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export function saveModelSettings(settings: ModelSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function formatModelOptionLabel(model: (typeof AVAILABLE_GEMINI_MODELS)[number]): string {
  const input = model.inputPricePerMillion.toFixed(2);
  const output = model.outputPricePerMillion.toFixed(2);
  return `${model.label} ($${input}/$${output} per 1M tokens)`;
}

export function parseModelOverride(
  value: FormDataEntryValue | string | null | undefined,
): GeminiModelId | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  return isAllowedGeminiModel(trimmed) ? trimmed : undefined;
}

export function appendMainRunModelsToFormData(
  formData: FormData,
  settings: ModelSettings,
): void {
  formData.set("modelMinutes", settings.mainMinutes);
  formData.set("modelTodos", settings.mainTodos);
}

export function mainRunModelOverridesFromFormData(
  formData: FormData,
): { modelMinutes?: GeminiModelId; modelTodos?: GeminiModelId } {
  return {
    modelMinutes: parseModelOverride(formData.get("modelMinutes")),
    modelTodos: parseModelOverride(formData.get("modelTodos")),
  };
}

export function omissionsModelOverridesFromBody(body: unknown): {
  modelMinutes?: GeminiModelId;
  modelTodos?: GeminiModelId;
} {
  if (typeof body !== "object" || body === null) {
    return {};
  }

  const record = body as Record<string, unknown>;
  return {
    modelMinutes: parseModelOverride(
      typeof record.modelMinutes === "string" ? record.modelMinutes : undefined,
    ),
    modelTodos: parseModelOverride(
      typeof record.modelTodos === "string" ? record.modelTodos : undefined,
    ),
  };
}
