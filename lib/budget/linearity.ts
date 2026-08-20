import type { BudgetLineItem, LineYearAmounts } from "@/lib/budget/types";

/** A fit needs 3+ years; two points always lie on a line. */
const MIN_POINTS = 3;

export type LinearityScore = {
  /**
   * 1 − RMSE / mean(|amount|). 1 = points sit on a straight line.
   * This matches a $0-based chart better than R², which punishes
   * nearly-flat series (tiny variance) and rewards any upward staircase.
   */
  score: number;
  pointCount: number;
  field: "budgeted" | "actual";
};

type Point = { x: number; y: number };

function collectPoints(
  byYear: Record<number, LineYearAmounts>,
  years: number[],
  field: "budgeted" | "actual",
): Point[] {
  const points: Point[] = [];
  for (const year of years) {
    const value = byYear[year]?.[field];
    if (value == null || !Number.isFinite(value)) continue;
    points.push({ x: year, y: value });
  }
  return points;
}

function fitRmse(points: Point[]): number | null {
  const n = points.length;
  if (n < MIN_POINTS) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  let ssRes = 0;
  for (const point of points) {
    const err = point.y - (intercept + slope * point.x);
    ssRes += err * err;
  }
  return Math.sqrt(ssRes / n);
}

/**
 * How tightly points hug a straight line, relative to typical magnitude.
 * A $300 wobble on an $8,000 flat fee scores high; the same wobble on a
 * $400 account does not. A perfectly flat series scores 1.
 */
export function relativeLineFit(points: Point[]): number | null {
  const rmse = fitRmse(points);
  if (rmse == null) return null;

  let meanAbs = 0;
  for (const point of points) meanAbs += Math.abs(point.y);
  meanAbs /= points.length;
  if (meanAbs < 1e-12) return 1;
  return Math.max(0, Math.min(1, 1 - rmse / meanAbs));
}

function scoreSeries(
  points: Point[],
  field: "budgeted" | "actual",
): LinearityScore | null {
  const score = relativeLineFit(points);
  if (score == null) return null;
  return { score, pointCount: points.length, field };
}

/**
 * Linearity of the plotted chart: budgeted and actual are scored
 * separately and the worse one is shown, so a curved actuals line
 * cannot hide behind a tidy budget staircase.
 */
export function lineItemLinearity(
  line: Pick<BudgetLineItem, "byYear">,
  years: number[],
): LinearityScore | null {
  const budgeted = scoreSeries(
    collectPoints(line.byYear, years, "budgeted"),
    "budgeted",
  );
  const actual = scoreSeries(
    collectPoints(line.byYear, years, "actual"),
    "actual",
  );
  if (budgeted && actual) {
    return budgeted.score <= actual.score ? budgeted : actual;
  }
  return budgeted ?? actual;
}

export function formatLinearityPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}
