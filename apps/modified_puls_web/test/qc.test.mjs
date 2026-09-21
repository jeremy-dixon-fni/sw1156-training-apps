import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QC_RESULT,
  RESOLUTION_REVIEW,
  evaluateReachCurve,
  evaluateGeometryAction,
  evaluateResolution,
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

test("resolution curves use neutral labels and coincide where samples are shared", () => {
  const { A, B } = RESOLUTION_REVIEW.curves;
  assert.equal(A.label, "Curve A (8 points)");
  assert.equal(B.label, "Curve B (11 points)");

  const shared = A.storageAcft
    .map((storage, index) => ({ storage, discharge: A.dischargeCfs[index] }))
    .filter(({ storage }) => B.storageAcft.includes(storage));
  assert.deepEqual(shared.map(({ storage }) => storage), [0, 38, 175]);
  for (const point of shared) {
    assert.equal(B.dischargeCfs[B.storageAcft.indexOf(point.storage)], point.discharge);
  }
});

test("resolution curves differ clearly only within the routed range", () => {
  const { A, B } = RESOLUTION_REVIEW.curves;
  const outsideA = A.dischargeCfs
    .map((discharge, index) => [A.storageAcft[index], discharge])
    .filter(([, discharge]) => discharge < 400 || discharge > 1200);
  assert.deepEqual(outsideA, [[0, 0], [38, 235], [175, 1203], [220, 1562]]);
  assert.deepEqual(B.storageAcft, [0, 12, 25, 38, 50, 60, 175, 200, 225, 250, 280]);
  assert.deepEqual(B.dischargeCfs, [0, 73, 153, 235, 313, 378, 1203, 1400, 1603, 1813, 2072]);

  const bStorageAt = (discharge) => 60 + (discharge - 378) * (175 - 60) / (1203 - 378);
  const inRangeSeparation = A.dischargeCfs
    .map((discharge, index) => ({ discharge, separation: A.storageAcft[index] - bStorageAt(discharge) }))
    .filter(({ discharge }) => discharge >= 400 && discharge <= 1200)
    .map(({ separation }) => separation);
  assert.ok(Math.max(...inRangeSeparation) >= 25);
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
