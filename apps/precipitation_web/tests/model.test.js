"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Model = require(path.join(__dirname, "..", "js", "model.js"));

const depthAtlas = Model.parseAtlas14CsvText(Model.SAMPLE_ATLAS14_CSV);
assert.equal(depthAtlas.sourceQuantity, "depth");
assert.equal(depthAtlas.seriesType, "partial duration");
assert.ok(Math.abs(Model.getDepth(depthAtlas, 2, 1440) - 3.95) < 1e-12);

const durations = [...new Set(depthAtlas.depthTable.map(row => row.durationMin))];
const labels = Object.fromEntries(depthAtlas.depthTable.map(row => [row.durationMin, row.duration]));
const intensityRows = durations.map(duration => {
  const values = depthAtlas.returnPeriods.map(ari => Model.intensityFromDepth(Model.getDepth(depthAtlas, ari, duration), duration));
  return `${labels[duration]}:,${values.map(value => value.toFixed(9)).join(",")}`;
});
const intensityCsv = [
  "Point precipitation frequency estimates (inches/hour)",
  "Data type: Precipitation intensity",
  "Time series type: Annual maximum",
  `by duration for ARI (years):,${depthAtlas.returnPeriods.join(",")}`,
  ...intensityRows
].join("\n");

const intensityAtlas = Model.parseAtlas14CsvText(intensityCsv);
assert.equal(intensityAtlas.sourceQuantity, "intensity");
assert.equal(intensityAtlas.seriesType, "annual maximum");
assert.ok(Math.abs(Model.getDepth(intensityAtlas, 100, 180) - 5.42) < 1e-7);
assert.ok(Math.abs(Model.getDepth(intensityAtlas, 2, 1440) - 3.95) < 1e-7);

const formatDirectory = path.join(__dirname, "..", "data", "a14_format");
const partialDurationAtlas = Model.parseAtlas14CsvText(
  fs.readFileSync(path.join(formatDirectory, "PF_Depth_English_PDS.csv"), "utf8")
);
assert.equal(partialDurationAtlas.seriesType, "partial duration");
assert.deepEqual(partialDurationAtlas.returnPeriods, [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000]);
assert.ok(Math.abs(Model.getDepth(partialDurationAtlas, 100, 1440) - 9.72) < 1e-12);

const annualMaximumAtlas = Model.parseAtlas14CsvText(
  fs.readFileSync(path.join(formatDirectory, "PF_Depth_English_AMS.csv"), "utf8")
);
assert.equal(annualMaximumAtlas.seriesType, "annual maximum");
assert.deepEqual(annualMaximumAtlas.returnPeriods, [2, 5, 10, 25, 50, 100, 200, 500, 1000]);
assert.ok(Math.abs(Model.getDepth(annualMaximumAtlas, 2, 1440) - 3.56) < 1e-12);
assert.ok(Math.abs(Model.getDepth(annualMaximumAtlas, 100, 1440) - 9.27) < 1e-12);

console.log("All precipitation model checks passed.");
