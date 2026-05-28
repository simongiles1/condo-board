import { computeUniqueBodyText } from "@/lib/email/quote-strip";

export type ThreadMessageForDiff = {
  id: string;
  bodyText: string;
  bodyHtml?: string | null;
  receivedAt: string;
};

/** Remove content already present in prior messages (after quote strip). */
export function diffAgainstPriorMessages(
  message: ThreadMessageForDiff,
  priorMessages: ThreadMessageForDiff[],
): string {
  const stripped = computeUniqueBodyText(message.bodyText, message.bodyHtml);
  if (!priorMessages.length) return stripped;

  const priorBodies = priorMessages
    .map((m) => computeUniqueBodyText(m.bodyText, m.bodyHtml))
    .filter(Boolean);

  let unique = stripped;
  for (const prior of priorBodies) {
    if (!prior.trim()) continue;
    if (unique.includes(prior)) {
      unique = unique.replace(prior, "").trim();
    }
    const priorLines = prior.split(/\r?\n/).filter((l) => l.trim().length > 20);
    for (const line of priorLines) {
      if (unique.includes(line)) {
        unique = unique.replace(line, "").trim();
      }
    }
  }

  return unique.replace(/\n{3,}/g, "\n\n").trim() || stripped;
}

export function computeThreadUniqueBodies(
  messages: ThreadMessageForDiff[],
): Map<string, string> {
  const sorted = [...messages].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt),
  );
  const result = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const prior = sorted.slice(0, i);
    result.set(sorted[i].id, diffAgainstPriorMessages(sorted[i], prior));
  }

  return result;
}
