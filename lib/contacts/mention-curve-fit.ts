/**
 * Rank-frequency curve fits for mention charts.
 *
 * Sorted mention counts (highest → lowest) typically follow Zipf's law
 * (power-law decay) or a simple exponential. We fit both via log-linear
 * least squares and keep the better R² so parameters refresh whenever
 * the series changes.
 */

export type MentionCurveModel = "zipf" | "exponential";

export type MentionCurveFit = {
  model: MentionCurveModel;
  /** Scale: y ≈ A / rank^s  or  y ≈ A · e^(-λ · rank). */
  A: number;
  /** Zipf exponent s, or exponential rate λ. */
  param: number;
  /** Coefficient of determination on the log-linear regression. */
  r2: number;
  /** Human-readable equation (ASCII-ish for UI). */
  equation: string;
  predict: (rank: number) => number;
};

type LinReg = {
  slope: number;
  intercept: number;
  r2: number;
};

function linearRegression(xs: number[], ys: number[]): LinReg | null {
  const n = xs.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i]!;
    const err = ys[i]! - pred;
    ssRes += err * err;
    const d = ys[i]! - meanY;
    ssTot += d * d;
  }

  const r2 = ssTot < 1e-12 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  return { slope, intercept, r2 };
}

function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toPrecision(3);
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/**
 * Fit Zipf and exponential models to descending mention counts.
 * Rank is 1-based (first bar = rank 1).
 */
export function fitMentionFrequencyCurve(
  counts: readonly number[],
): MentionCurveFit | null {
  const pairs: Array<{ rank: number; count: number }> = [];
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i]!;
    if (!(count > 0) || !Number.isFinite(count)) continue;
    pairs.push({ rank: i + 1, count });
  }
  if (pairs.length < 2) return null;

  const lnY = pairs.map((p) => Math.log(p.count));

  const zipfReg = linearRegression(
    pairs.map((p) => Math.log(p.rank)),
    lnY,
  );
  const expReg = linearRegression(
    pairs.map((p) => p.rank),
    lnY,
  );

  let zipf: MentionCurveFit | null = null;
  if (zipfReg && zipfReg.slope <= 0) {
    const A = Math.exp(zipfReg.intercept);
    const s = -zipfReg.slope;
    zipf = {
      model: "zipf",
      A,
      param: s,
      r2: zipfReg.r2,
      equation: `y = ${fmtNum(A)} / r^${fmtNum(s)}`,
      predict: (rank) => {
        if (!(rank > 0)) return 0;
        return A / Math.pow(rank, s);
      },
    };
  }

  let exponential: MentionCurveFit | null = null;
  if (expReg && expReg.slope <= 0) {
    const A = Math.exp(expReg.intercept);
    const lambda = -expReg.slope;
    exponential = {
      model: "exponential",
      A,
      param: lambda,
      r2: expReg.r2,
      equation: `y = ${fmtNum(A)} · e^(-${fmtNum(lambda)} · r)`,
      predict: (rank) => {
        if (!(rank > 0)) return 0;
        return A * Math.exp(-lambda * rank);
      },
    };
  }

  if (zipf && exponential) {
    return zipf.r2 >= exponential.r2 ? zipf : exponential;
  }
  return zipf ?? exponential;
}
