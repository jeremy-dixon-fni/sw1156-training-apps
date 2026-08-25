"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Model = require(path.join(__dirname, "..", "js", "model.js"));

const baseline = Model.computeInitialConstantLosses(1.0, 0.20, 30);
const summary = Model.summarizeResult(baseline);
assert.ok(Math.abs(summary.finalRunoffIn + summary.totalLossIn - Model.TOTAL_RAINFALL_IN) < 1e-9);
assert.ok(summary.maximumAbsoluteMassBalanceErrorIn < 1e-12);

const initialTarget = Model.summarizeResult(Model.computeInitialConstantLosses(3.0, 0.20, 30)).finalRunoffIn;
const constantTarget = Model.summarizeResult(Model.computeInitialConstantLosses(1.0, 0.50, 30)).finalRunoffIn;
const imperviousTarget = Model.summarizeResult(Model.computeInitialConstantLosses(1.0, 0.20, 50)).totalLossIn;
assert.ok(initialTarget < summary.finalRunoffIn);
assert.ok(constantTarget < summary.finalRunoffIn);
assert.ok(imperviousTarget < summary.totalLossIn);

const combined = Model.computeInitialConstantLosses(2.0, 0.35, 50);
const time50 = Model.firstCrossingTime(combined.timeHr, Model.cumulativeRunoffPercent(combined), 50);
assert.ok(Number.isFinite(time50));

console.log("All losses model checks passed.");
