/** Parse / format mailbox addresses (client-safe). */

export function parseStoredFromAddress(raw: string): {
  name: string | null;
  email: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { name: null, email: null };

  const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const namePart = angleMatch[1].trim().replace(/^"|"$/g, "").trim();
    return {
      name: namePart || null,
      email: angleMatch[2].trim(),
    };
  }

  if (trimmed.includes("@")) {
    return { name: null, email: trimmed };
  }

  const name = trimmed.replace(/^"+|"+$/g, "").trim();
  return { name: name || null, email: null };
}

/** Bare mailbox email from a stored `Name <email>` or bare address. */
export function extractMailboxEmail(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null;
  const { email } = parseStoredFromAddress(raw);
  if (email?.includes("@")) return email.trim();
  return null;
}

/**
 * Format a participant for storage / LLM prompts.
 * Keeps display names so contact extraction can use header evidence.
 */
export function formatMailboxAddress(
  name: string | null | undefined,
  email: string,
): string {
  const address = email.trim();
  if (!address) return "";
  const display = name?.trim().replace(/^"|"$/g, "").trim() || null;
  if (!display) return address;
  if (/[,<>"]/.test(display)) {
    return `"${display.replace(/"/g, "")}" <${address}>`;
  }
  return `${display} <${address}>`;
}
