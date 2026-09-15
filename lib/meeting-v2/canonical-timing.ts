/** Render overlay timing from the same sequence ranges used to assemble evidence. */
export function canonicalDiscussionTiming(ranges: Array<[number, number]>, segments: Array<{
  sequence: number; startTimestamp: string; endTimestamp: string;
}>): string | null {
  const bySequence = new Map(segments.map(segment => [segment.sequence, segment]));
  return ranges.map(([start, end]) => {
    const first = bySequence.get(start);
    const last = bySequence.get(end);
    if (!first || !last) throw new Error(`Transcript range ${start}-${end} refers to missing segments.`);
    return `${first.startTimestamp} - ${last.endTimestamp}`;
  }).join("; ") || null;
}

export function withCanonicalDiscussionTiming(sourceText: string | null, timing: string | null): string {
  const content = (sourceText ?? "").split(/\r?\n/).filter(line => !/^discussion timing:/i.test(line.trim()));
  if (timing) content.push(`Discussion timing: ${timing}`);
  return content.join("\n").trim();
}
