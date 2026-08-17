import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitMentionFrequencyCurve } from "../lib/contacts/mention-curve-fit";

describe("fitMentionFrequencyCurve", () => {
  it("recovers Zipf parameters on synthetic power-law data", () => {
    const A = 100;
    const s = 0.8;
    const counts = Array.from({ length: 40 }, (_, i) =>
      A / Math.pow(i + 1, s),
    );
    const fit = fitMentionFrequencyCurve(counts);
    assert.ok(fit);
    assert.equal(fit!.model, "zipf");
    assert.ok(Math.abs(fit!.A - A) / A < 0.05);
    assert.ok(Math.abs(fit!.param - s) < 0.05);
    assert.ok(fit!.r2 > 0.99);
  });

  it("recovers exponential parameters on synthetic exp data", () => {
    const A = 80;
    const lambda = 0.12;
    const counts = Array.from({ length: 40 }, (_, i) =>
      A * Math.exp(-lambda * (i + 1)),
    );
    const fit = fitMentionFrequencyCurve(counts);
    assert.ok(fit);
    assert.equal(fit!.model, "exponential");
    assert.ok(Math.abs(fit!.A - A) / A < 0.08);
    assert.ok(Math.abs(fit!.param - lambda) < 0.02);
    assert.ok(fit!.r2 > 0.99);
  });

  it("returns null for fewer than two positive counts", () => {
    assert.equal(fitMentionFrequencyCurve([]), null);
    assert.equal(fitMentionFrequencyCurve([12]), null);
    assert.equal(fitMentionFrequencyCurve([0, 0]), null);
  });

  it("predicts values near the fitted curve", () => {
    const counts = [50, 30, 20, 15, 12, 10, 8, 7, 6, 5];
    const fit = fitMentionFrequencyCurve(counts);
    assert.ok(fit);
    const y1 = fit!.predict(1);
    const y10 = fit!.predict(10);
    assert.ok(y1 > y10);
    assert.ok(y1 > 0);
  });
});
