/** Parse a stored From value into display name and email (client-safe). */

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
