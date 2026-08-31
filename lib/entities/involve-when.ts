/**
 * Role-based “get me involved when” copy from a job title.
 * Not history-seeded — label it as role-based in the UI.
 */

export type InvolveWhen = {
  prompt: string;
  examples: string[];
};

function has(title: string, pattern: RegExp): boolean {
  return pattern.test(title);
}

/**
 * Map a job title to a short involvement prompt.
 * Returns null when there is no title (do not invent).
 */
export function involveWhenFromJobTitle(
  title: string | null | undefined,
): InvolveWhen | null {
  const raw = title?.trim();
  if (!raw) return null;
  const key = raw.toLowerCase();

  if (
    has(
      key,
      /\b(solicitor|counsel|lawyer|attorney|legal|lash\s+condo)\b/,
    )
  ) {
    return {
      prompt:
        "Involve when contracts, collections, or legal notices need counsel.",
      examples: ["contract change", "collections / legal notice"],
    };
  }

  if (has(key, /\b(engineer|consultant|engineering)\b/)) {
    return {
      prompt:
        "Involve for specs, deficiencies, and reserve / capital-planning items.",
      examples: ["spec review", "deficiency / reserve item"],
    };
  }

  if (has(key, /\b(concierge|security|guard)\b/)) {
    return {
      prompt: "Involve for access, incidents, and after-hours building issues.",
      examples: ["access issue", "incident / after-hours"],
    };
  }

  if (
    has(
      key,
      /\b(property\s+manager|assistant\s+(property\s+)?manager|assistant\s+pm|\bpm\b|management)\b/,
    )
  ) {
    return {
      prompt:
        "Involve when unit complaints, contractor access, or building operations need management.",
      examples: ["complaint filed", "contractor access"],
    };
  }

  if (
    has(
      key,
      /\b(board|president|treasurer|director|secretary)\b/,
    )
  ) {
    return {
      prompt: "Involve for votes, owner notices, and budget decisions.",
      examples: ["board vote", "owner notice / budget"],
    };
  }

  return {
    prompt: `Involve for matters matching this role: ${raw}.`,
    examples: [],
  };
}
