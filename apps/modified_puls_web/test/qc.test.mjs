import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QC_RESULT,
  SUBREACH_REVIEW,
  evaluateReachCurve,
  evaluateGeometryAction,
  evaluateResolution,
  evaluateSubreaches,
  evaluateFinalReview,
  geometryComparison,
  finalReviewRouting,
} from "../js/qc.js";

test("reach review requires the matching curve to be accepted", () => {
  assert.equal(evaluateReachCurve("MP03_PROP_2", "accept").status, QC_RESULT.ACCEPTABLE);
  assert.equal(evaluateReachCurve("MP03_PROP", "accept").status, QC_RESULT.INCORRECT);
  assert.equal(evaluateReachCurve("MP03_PROP", "reject").status, QC_RESULT.CLOSE);
});

test("geometry review requires regeneration", () => {
  assert.equal(evaluateGeometryAction("regenerate").status, QC_RESULT.ACCEPTABLE);
  assert.equal(evaluateGeometryAction("keep").status, QC_RESULT.INCORRECT);
});

test("resolution review evaluates point distribution, not total count", () => {
  assert.equal(evaluateResolution("reject", "operating-range-resolution", "A").status, QC_RESULT.ACCEPTABLE);
  assert.equal(evaluateResolution("reject", "operating-range-resolution", "B").status, QC_RESULT.INCORRECT);
  assert.equal(evaluateResolution("accept", "", "").status, QC_RESULT.INCORRECT);
});

test("subreach result comes from scenario configuration", () => {
  const expectedDecision = SUBREACH_REVIEW.acceptable ? "accept" : "reject";
  assert.equal(evaluateSubreaches(expectedDecision).status, QC_RESULT.ACCEPTABLE);
  assert.match(SUBREACH_REVIEW.referenceLabel, /not a universal criterion/i);
});

test("final review requires exactly the documented issues", () => {
  assert.equal(evaluateFinalReview("return", ["stale-geometry", "inadequate-resolution"]).status, QC_RESULT.ACCEPTABLE);
  assert.equal(evaluateFinalReview("approve", []).status, QC_RESULT.INCORRECT);
  assert.equal(evaluateFinalReview("return", ["stale-geometry"]).status, QC_RESULT.CLOSE);
  assert.equal(evaluateFinalReview("return", ["stale-geometry", "wrong-reach"]).status, QC_RESULT.INCORRECT);
});

test("checkpoint comparison routing remains numerically functional", () => {
  const comparison = geometryComparison();
  assert.equal(comparison.timeMin.length, comparison.oldOutflowCfs.length);
  assert.equal(comparison.timeMin.length, comparison.currentOutflowCfs.length);
  assert.ok(comparison.oldPeak.peak > 0);
  assert.ok(comparison.currentPeak.peak > 0);
  assert.notEqual(comparison.oldPeak.peak, comparison.currentPeak.peak);

  const final = finalReviewRouting();
  assert.equal(final.timeMin.length, final.inflowCfs.length);
  assert.equal(final.timeMin.length, final.outflowCfs.length);
  assert.ok(final.outflowCfs.every(Number.isFinite));
});
