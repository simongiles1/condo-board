/** A repair is only a candidate: it always receives a fresh review before it can be saved. */
export async function reviewAndRepairOnce<T, R>(investigation: T, steps: {
  review: (candidate: T) => Promise<R>;
  requiresRepair: (review: R) => boolean;
  repair: (candidate: T, review: R) => Promise<T>;
}): Promise<{ investigation: T; review: R; repaired: boolean }> {
  const first = await steps.review(investigation);
  if (!steps.requiresRepair(first)) return { investigation, review: first, repaired: false };
  const candidate = await steps.repair(investigation, first);
  const final = await steps.review(candidate);
  return { investigation: candidate, review: final, repaired: true };
}
