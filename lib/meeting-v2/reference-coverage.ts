import type { ReferenceMeetingExpectation } from "./reference-expectations";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Coverage is a fixture comparison, not a quality score inferred from row counts. */
export function compareReferenceTopics(expectation: ReferenceMeetingExpectation | null,
  actual: Array<{ id: string; title: string }>) {
  if (!expectation) return { available: false as const, topicCoveragePercent: null,
    expectedTopicCount: null, actualTopicCount: actual.length, matchedTopicCount: null,
    missingTopicCount: null, extraTopicCount: null, matches: [], extraActualTopics: [],
    notes: ["No curated reference expectation is configured for this meeting."] };
  const used = new Set<string>();
  const matches = expectation.expectedTopics.map(expected => {
    const phrases = [expected.title, ...expected.aliases].map(normalize).filter(Boolean);
    const candidates = actual.filter(a => !used.has(a.id)).map(a => ({ actual: a,
      score: Math.max(...phrases.map(phrase => normalize(a.title) === phrase ? 1 : normalize(a.title).includes(phrase) && phrase.length >= 12 ? 0.8 : 0)) }))
      .filter(c => c.score > 0).sort((a, b) => b.score - a.score);
    const match = candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score) ? candidates[0] : null;
    if (match) used.add(match.actual.id);
    return { expected, matchedTopicId: match?.actual.id ?? null, matchedTitle: match?.actual.title ?? null,
      score: match?.score ?? 0, status: match ? "matched" : candidates.length ? "ambiguous" : "missing" };
  });
  return { available: true as const, expectedTopicCount: expectation.expectedTopics.length, actualTopicCount: actual.length,
    matchedTopicCount: used.size, missingTopicCount: matches.filter(m => m.status !== "matched").length,
    extraTopicCount: actual.length - used.size, topicCoveragePercent: expectation.expectedTopics.length ? 100 * used.size / expectation.expectedTopics.length : 0,
    matches, extraActualTopics: actual.filter(a => !used.has(a.id)), notes: ["Topic coverage is matched against curated expectations; it does not replace factual validation."] };
}
