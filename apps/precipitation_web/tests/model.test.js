"use strict";

const assert = require("node:assert/strict");
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

console.log("All precipitation model checks passed.");
