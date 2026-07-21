"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Model = require(path.join(__dirname, "..", "js", "model.js"));

function byPath(results) {
  return Object.fromEntries(results.map(item => [item.pathId, item]));
}

assert.equal(Model.EXCESS_IN.length, 577);
assert.ok(Math.abs(Model.TOTAL_EXCESS_IN - 7.094) < 1e-9);
assert.equal(Model.EXCESS_TIMESTEP_MIN, 5);
assert.equal(Model.DRAINAGE_AREA_SQMI, 21.4656);
assert.equal(Model.REMOVED_COMMON_CHANNEL_LENGTH_FT, 43153.667588);

const expectedLengths = {
  1: [52576.254423, 49999.812686],
  2: [42625.602916, 37948.418313],
  3: [42364.131054, 35996.414279],
  4: [41581.633220, 37029.747408]
};
for (const [pathIdText, [totalLength, channelLength]] of Object.entries(expectedLengths)) {
  const item = Model.FLOW_PATHS[Number(pathIdText)];
  assert.ok(Math.abs(item.totalLengthFt - totalLength) < 1e-6);
  assert.ok(Math.abs(item.mappedChannelLengthFt - channelLength) < 1e-6);
}

const tr55Default = byPath(Model.calculateMethodResults({
  method: "tr55",
  sheetLimitFt: 100,
  shallowLimitFt: 2000,
  kerbyLimitFt: 1200
}));
assert.ok(Math.abs(tr55Default[1].totalTimeMin - 149.75246) < 0.02);
assert.ok(Math.abs(tr55Default[3].totalTimeMin - 136.76819) < 0.02);
assert.equal(tr55Default[1].rank, 1);
assert.equal(tr55Default[1].sheetSurfaceKey, "smooth");
assert.equal(tr55Default[1].shallowSurfaceKey, "paved");

const roughSheet = byPath(Model.calculateMethodResults({
  method: "tr55",
  sheetLimitFt: 100,
  shallowLimitFt: 2000,
  sheetSurfaceKeys: { 1: "woods_dense" }
}));
assert.ok(roughSheet[1].sheetTimeMin > tr55Default[1].sheetTimeMin);
assert.ok(Math.abs(roughSheet[2].totalTimeMin - tr55Default[2].totalTimeMin) < 1e-12);

const pavedShallow = byPath(Model.calculateMethodResults({
  method: "tr55",
  sheetLimitFt: 100,
  shallowLimitFt: 2000,
  shallowSurfaceKeys: { 2: "paved" }
}));
assert.ok(pavedShallow[2].shallowVelocityFps > tr55Default[2].shallowVelocityFps);
assert.ok(pavedShallow[2].shallowTimeMin < tr55Default[2].shallowTimeMin);

const slowChannel = byPath(Model.calculateMethodResults({ method: "tr55", sheetLimitFt: 100, shallowLimitFt: 2000, channelVelocityFps: 2 }));
const fastChannel = byPath(Model.calculateMethodResults({ method: "tr55", sheetLimitFt: 100, shallowLimitFt: 2000, channelVelocityFps: 10 }));
for (const pathId of [1, 2, 3, 4]) {
  assert.ok(slowChannel[pathId].channelTimeMin > tr55Default[pathId].channelTimeMin);
  assert.ok(fastChannel[pathId].channelTimeMin < tr55Default[pathId].channelTimeMin);
}

const kerbyDefault = byPath(Model.calculateMethodResults({ method: "kerby", kerbyLimitFt: 1200 }));
assert.equal(kerbyDefault[1].rank, 1);
assert.ok(Math.abs(kerbyDefault[1].totalTimeMin - 242.50901) < 0.02);
const kerbyRough = byPath(Model.calculateMethodResults({ method: "kerby", kerbyLimitFt: 1200, kerbySurfaceKeys: { 1: "dense_cover" } }));
assert.ok(kerbyRough[1].kerbyTimeMin > kerbyDefault[1].kerbyTimeMin);

const defaultHydro = Model.addHydrographMetrics(Object.values(tr55Default));
const slowHydro = Model.addHydrographMetrics(Object.values(slowChannel));
for (const pathId of [1, 2, 3, 4]) {
  const baseline = defaultHydro.find(item => item.pathId === pathId).peakFlowCfs;
  const slower = slowHydro.find(item => item.pathId === pathId).peakFlowCfs;
  assert.ok(slower < baseline);
  assert.ok(baseline > 28000 && baseline < 32000);
}

assert.deepEqual(Model.LAG_RATIO_OPTIONS, [0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7]);
assert.deepEqual(Model.PEAK_RATE_FACTOR_OPTIONS, [100, 150, 200, 250, 300, 350, 400, 450, 484, 500, 550, 600]);

const gammaM484 = Model.solveGammaShapeFactor(484);
assert.ok(Math.abs(gammaM484 - 3.696913) < 1e-5);
assert.ok(Math.abs(Model.peakRateFactorFromGammaShape(gammaM484) - 484) < 1e-8);

const fixedPath = Model.fixedTransformSensitivityPath();
assert.equal(fixedPath.pathId, 1);
assert.ok(Math.abs(fixedPath.sheetLengthFt - 100) < 1e-12);
assert.ok(Math.abs(fixedPath.shallowLengthFt - 1000) < 1e-12);
assert.ok(Math.abs(fixedPath.channelVelocityFps - 6) < 1e-12);
assert.ok(Math.abs(fixedPath.totalTimeMin - 148.1896543) < 0.02);

const lowPrf = Model.convolveTransformCase(fixedPath.totalTimeMin, 0.60, 100);
const highPrf = Model.convolveTransformCase(fixedPath.totalTimeMin, 0.60, 600);
assert.ok(highPrf.peakFlowCfs > lowPrf.peakFlowCfs);

const shortLag = Model.convolveTransformCase(fixedPath.totalTimeMin, 0.50, 484);
const longLag = Model.convolveTransformCase(fixedPath.totalTimeMin, 0.70, 484);
assert.ok(shortLag.peakFlowCfs > longLag.peakFlowCfs);
assert.ok(shortLag.peakTimestampMs < longLag.peakTimestampMs);

const sensitivity = Model.calculateTransformSensitivity(0.60, 484);
assert.equal(sensitivity.solutionCount, 252);
for (let i = 0; i < sensitivity.selected.hydrographCfs.length; i += 1) {
  assert.ok(sensitivity.selected.hydrographCfs[i] >= sensitivity.envelopeMinCfs[i] - 1e-9);
  assert.ok(sensitivity.selected.hydrographCfs[i] <= sensitivity.envelopeMaxCfs[i] + 1e-9);
}
assert.ok(sensitivity.minimumPeakCfs < sensitivity.selected.peakFlowCfs);
assert.ok(sensitivity.selected.peakFlowCfs < sensitivity.maximumPeakCfs);

console.log("All JavaScript model checks passed.");
