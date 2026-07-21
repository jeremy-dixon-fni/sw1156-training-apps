/*
 * Transform Flow Path Explorer - engineering model
 * Static JavaScript port of the Version 4 Python calculation layer.
 * No DOM or Plotly dependencies are allowed in this file.
 */
(function (globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  globalScope.TransformModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BUILD_VERSION = "1.2.0";

  const COLORS = Object.freeze({
    FNI_BLUE: "#015D91",
    FNI_GREEN: "#A9C945",
    FNI_NAVY: "#093D5E",
    FNI_YELLOW: "#DEB326",
    FNI_ORANGE: "#E05126",
    FNI_TURQUOISE: "#5BC1CF",
    FNI_AQUA: "#45A6DD",
    FNI_NEUTRAL_BLUE: "#93AFB4",
    FNI_DARK_GRAY: "#4D4D4F",
    FNI_GRAY: "#B1B1B1"
  });

  const PATH_COLORS = Object.freeze({
    1: COLORS.FNI_NAVY,
    2: COLORS.FNI_ORANGE,
    3: COLORS.FNI_GREEN,
    4: COLORS.FNI_AQUA
  });

  const DRAINAGE_AREA_SQMI = 21.4656;
  const REMOVED_COMMON_CHANNEL_LENGTH_FT = 43153.667588;
  const P2_24HR_IN = 4.0;
  const DEFAULT_CHANNEL_VELOCITY_FPS = 6.0;
  const LAG_RATIO = 0.60;
  const PEAK_RATE_FACTOR = 484;
  const EXCESS_TIMESTEP_MIN = 5;
  const EVENT_START_UTC_MS = Date.UTC(1900, 0, 1, 0, 0, 0);

  const LAG_RATIO_OPTIONS = Object.freeze(Array.from({ length: 21 }, (_, i) => Number((0.50 + i * 0.01).toFixed(2))));
  const PEAK_RATE_FACTOR_OPTIONS = Object.freeze([100, 150, 200, 250, 300, 350, 400, 450, 484, 500, 550, 600]);
  const TR55_SHEET_OPTIONS_FT = Object.freeze([50, 100, 300]);
  const TR55_SHALLOW_OPTIONS_FT = Object.freeze([1000, 2000, 3000]);
  const KERBY_LENGTH_OPTIONS_FT = Object.freeze([500, 1000, 1200]);

  const SENSITIVITY_PATH_ID = 1;
  const SENSITIVITY_SHEET_LIMIT_FT = 100;
  const SENSITIVITY_SHALLOW_LIMIT_FT = 1000;
  const SENSITIVITY_CHANNEL_VELOCITY_FPS = 6;

  const SHEET_FLOW_SURFACES = Object.freeze({
    smooth: Object.freeze({ label: "Smooth surface", n: 0.011 }),
    fallow: Object.freeze({ label: "Fallow, no residue", n: 0.05 }),
    cultivated_low: Object.freeze({ label: "Cultivated, <=20% residue", n: 0.06 }),
    natural_range: Object.freeze({ label: "Natural range", n: 0.13 }),
    short_grass: Object.freeze({ label: "Short grass prairie", n: 0.15 }),
    cultivated_high: Object.freeze({ label: "Cultivated, >20% residue", n: 0.17 }),
    dense_grass: Object.freeze({ label: "Dense grass", n: 0.24 }),
    woods_light: Object.freeze({ label: "Woods, light underbrush", n: 0.40 }),
    bermuda: Object.freeze({ label: "Bermuda grass", n: 0.41 }),
    woods_dense: Object.freeze({ label: "Woods, dense underbrush", n: 0.80 })
  });

  const SHALLOW_FLOW_SURFACES = Object.freeze({
    unpaved: Object.freeze({ label: "Unpaved", k: 16.13 }),
    paved: Object.freeze({ label: "Paved", k: 20.32 })
  });

  const KERBY_SURFACES = Object.freeze({
    pavement: Object.freeze({ label: "Pavement", n: 0.02 }),
    bare_soil: Object.freeze({ label: "Smooth, bare, packed soil", n: 0.10 }),
    poor_grass: Object.freeze({ label: "Poor grass / row crops", n: 0.20 }),
    average_grass: Object.freeze({ label: "Pasture / average grass", n: 0.40 }),
    deciduous_forest: Object.freeze({ label: "Deciduous forest", n: 0.60 }),
    dense_cover: Object.freeze({ label: "Dense grass / forest / deep litter", n: 0.80 })
  });

  const DEFAULT_SHEET_SURFACE_KEYS = Object.freeze({ 1: "smooth", 2: "short_grass", 3: "short_grass", 4: "short_grass" });
  const DEFAULT_SHALLOW_SURFACE_KEYS = Object.freeze({ 1: "paved", 2: "unpaved", 3: "unpaved", 4: "unpaved" });
  const DEFAULT_KERBY_SURFACE_KEYS = Object.freeze({ 1: "pavement", 2: "average_grass", 3: "average_grass", 4: "average_grass" });

  const FLOW_PATHS = Object.freeze({
    1: Object.freeze({
      pathId: 1,
      totalLengthFt: 52576.254423,
      nonchannelLimitFt: 2576.441737,
      nonchannelSlope: 0.035707,
      mappedChannelLengthFt: 49999.812686,
      mappedChannelSlope: 0.004646,
      surface: "Paved"
    }),
    2: Object.freeze({
      pathId: 2,
      totalLengthFt: 42625.602916,
      nonchannelLimitFt: 4677.184603,
      nonchannelSlope: 0.026992,
      mappedChannelLengthFt: 37948.418313,
      mappedChannelSlope: 0.004591,
      surface: "Grassed"
    }),
    3: Object.freeze({
      pathId: 3,
      totalLengthFt: 42364.131054,
      nonchannelLimitFt: 6367.716775,
      nonchannelSlope: 0.017413,
      mappedChannelLengthFt: 35996.414279,
      mappedChannelSlope: 0.004621,
      surface: "Grassed"
    }),
    4: Object.freeze({
      pathId: 4,
      totalLengthFt: 41581.633220,
      nonchannelLimitFt: 4551.885812,
      nonchannelSlope: 0.019184,
      mappedChannelLengthFt: 37029.747408,
      mappedChannelSlope: 0.004856,
      surface: "Grassed"
    })
  });

  const EXCESS_IN = Object.freeze([0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.005, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.008, 0.008, 0.008, 0.008, 0.008, 0.009, 0.009, 0.009, 0.009, 0.009, 0.010, 0.010, 0.010, 0.010, 0.011, 0.011, 0.011, 0.011, 0.012, 0.012, 0.012, 0.013, 0.013, 0.013, 0.014, 0.014, 0.014, 0.015, 0.015, 0.016, 0.020, 0.021, 0.021, 0.022, 0.022, 0.023, 0.024, 0.024, 0.025, 0.026, 0.027, 0.028, 0.029, 0.030, 0.031, 0.033, 0.034, 0.036, 0.045, 0.047, 0.049, 0.051, 0.054, 0.057, 0.065, 0.069, 0.074, 0.080, 0.087, 0.096, 0.116, 0.131, 0.152, 0.210, 0.272, 0.663, 0.663, 0.663, 0.236, 0.166, 0.140, 0.123, 0.101, 0.091, 0.083, 0.077, 0.072, 0.067, 0.059, 0.056, 0.053, 0.050, 0.048, 0.046, 0.036, 0.035, 0.033, 0.032, 0.031, 0.030, 0.029, 0.028, 0.027, 0.026, 0.025, 0.024, 0.023, 0.023, 0.022, 0.021, 0.021, 0.020, 0.016, 0.015, 0.015, 0.015, 0.014, 0.014, 0.013, 0.013, 0.013, 0.012, 0.012, 0.012, 0.012, 0.011, 0.011, 0.011, 0.010, 0.010, 0.010, 0.010, 0.009, 0.009, 0.009, 0.009, 0.009, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.007, 0.007, 0.007, 0.007, 0.007, 0.005, 0.005, 0.005, 0.005, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000]);
  const TOTAL_EXCESS_IN = EXCESS_IN.reduce((sum, value) => sum + value, 0);
  const EVENT_TIMESTAMPS_MS = Object.freeze(EXCESS_IN.map((_, index) => EVENT_START_UTC_MS + index * EXCESS_TIMESTEP_MIN * 60 * 1000));

  function assertFinitePositive(value, label) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`);
  }

  function overallSlope(path) {
    const totalDrop = path.nonchannelLimitFt * path.nonchannelSlope + path.mappedChannelLengthFt * path.mappedChannelSlope;
    return totalDrop / path.totalLengthFt;
  }

  function validateFlowPaths(paths = Object.values(FLOW_PATHS)) {
    for (const path of paths) {
      assertFinitePositive(path.totalLengthFt, `Path ${path.pathId} total length`);
      assertFinitePositive(path.nonchannelLimitFt, `Path ${path.pathId} nonchannel limit`);
      assertFinitePositive(path.nonchannelSlope, `Path ${path.pathId} nonchannel slope`);
      assertFinitePositive(path.mappedChannelSlope, `Path ${path.pathId} channel slope`);
      const difference = Math.abs(path.nonchannelLimitFt + path.mappedChannelLengthFt - path.totalLengthFt);
      if (difference > 0.02) throw new Error(`Path ${path.pathId} split lengths do not reconcile with total length.`);
    }
    return true;
  }

  function calculateSheetTimeMin(roughnessN, lengthFt, slopeFtFt, p2_24hrIn = P2_24HR_IN) {
    if (!Number.isFinite(roughnessN) || roughnessN <= 0 || !Number.isFinite(lengthFt) || lengthFt < 0 || !Number.isFinite(slopeFtFt) || slopeFtFt <= 0) {
      throw new Error("Sheet-flow inputs must be physically valid.");
    }
    if (lengthFt === 0) return 0;
    const timeHr = 0.007 * Math.pow(roughnessN * lengthFt, 0.8) / (Math.pow(p2_24hrIn, 0.5) * Math.pow(slopeFtFt, 0.4));
    return timeHr * 60;
  }

  function calculateShallowVelocityFps(kValue, slopeFtFt) {
    assertFinitePositive(kValue, "Shallow-flow K");
    assertFinitePositive(slopeFtFt, "Shallow-flow slope");
    return kValue * Math.sqrt(slopeFtFt);
  }

  function calculateTravelTimeMin(lengthFt, velocityFps) {
    if (!Number.isFinite(lengthFt) || lengthFt < 0) throw new Error("Travel length must be nonnegative.");
    assertFinitePositive(velocityFps, "Velocity");
    return lengthFt / velocityFps / 60;
  }

  function calculateTr55Path(path, options = {}) {
    const sheetLimitFt = Number(options.sheetLimitFt ?? 100);
    const shallowLimitFt = Number(options.shallowLimitFt ?? 2000);
    const sheetSurfaceKey = options.sheetSurfaceKey ?? DEFAULT_SHEET_SURFACE_KEYS[path.pathId];
    const shallowSurfaceKey = options.shallowSurfaceKey ?? DEFAULT_SHALLOW_SURFACE_KEYS[path.pathId];
    const channelVelocityFps = Number(options.channelVelocityFps ?? DEFAULT_CHANNEL_VELOCITY_FPS);
    const sheetSurface = SHEET_FLOW_SURFACES[sheetSurfaceKey];
    const shallowSurface = SHALLOW_FLOW_SURFACES[shallowSurfaceKey];
    if (!sheetSurface) throw new Error(`Unsupported sheet-flow surface: ${sheetSurfaceKey}`);
    if (!shallowSurface) throw new Error(`Unsupported shallow-flow surface: ${shallowSurfaceKey}`);
    assertFinitePositive(channelVelocityFps, "Channel velocity");

    const sheetLengthFt = Math.min(sheetLimitFt, path.nonchannelLimitFt);
    const shallowAvailableFt = Math.max(path.nonchannelLimitFt - sheetLengthFt, 0);
    const shallowLengthFt = Math.min(shallowLimitFt, shallowAvailableFt);
    const remainingChannelLengthFt = path.totalLengthFt - sheetLengthFt - shallowLengthFt;
    const sheetTimeMin = calculateSheetTimeMin(sheetSurface.n, sheetLengthFt, path.nonchannelSlope);
    const shallowVelocityFps = calculateShallowVelocityFps(shallowSurface.k, path.nonchannelSlope);
    const shallowTimeMin = calculateTravelTimeMin(shallowLengthFt, shallowVelocityFps);
    const channelTimeMin = calculateTravelTimeMin(remainingChannelLengthFt, channelVelocityFps);
    const warnings = [];
    if (sheetLimitFt > 100) warnings.push("The selected sheet-flow length exceeds the 100-ft current-method limit and is shown as a sensitivity case.");
    if (shallowLengthFt < shallowLimitFt) warnings.push("The selected shallow-flow maximum reaches the mapped channel-start limit before the full maximum is used.");

    return {
      pathId: path.pathId,
      method: "TR-55",
      surface: `${sheetSurface.label} / ${shallowSurface.label}`,
      sheetSurfaceKey,
      sheetSurface: sheetSurface.label,
      sheetN: sheetSurface.n,
      shallowSurfaceKey,
      shallowSurface: shallowSurface.label,
      shallowK: shallowSurface.k,
      shallowVelocityFps,
      channelVelocityFps,
      sheetLengthFt,
      shallowLengthFt,
      remainingChannelLengthFt,
      sheetTimeMin,
      shallowTimeMin,
      channelTimeMin,
      totalTimeMin: sheetTimeMin + shallowTimeMin + channelTimeMin,
      warnings
    };
  }

  function calculateKerbyTimeMin(lengthFt, retardanceN, slopeFtFt) {
    assertFinitePositive(lengthFt, "Kerby length");
    assertFinitePositive(retardanceN, "Kerby retardance");
    assertFinitePositive(slopeFtFt, "Kerby slope");
    return 0.828 * Math.pow(lengthFt * retardanceN, 0.467) / Math.pow(slopeFtFt, 0.235);
  }

  function calculateKirpichTimeMin(lengthFt, slopeFtFt) {
    assertFinitePositive(lengthFt, "Kirpich length");
    assertFinitePositive(slopeFtFt, "Kirpich slope");
    return 0.0078 * Math.pow(lengthFt, 0.77) / Math.pow(slopeFtFt, 0.385);
  }

  function calculateKerbyKirpichPath(path, options = {}) {
    const kerbyLimitFt = Number(options.kerbyLimitFt ?? 1200);
    const kerbySurfaceKey = options.kerbySurfaceKey ?? DEFAULT_KERBY_SURFACE_KEYS[path.pathId];
    const surface = KERBY_SURFACES[kerbySurfaceKey];
    if (!surface) throw new Error(`Unsupported Kerby surface: ${kerbySurfaceKey}`);
    const kerbyLengthFt = Math.min(kerbyLimitFt, 1200, path.nonchannelLimitFt);
    const kirpichLengthFt = path.totalLengthFt - kerbyLengthFt;
    const kerbyTimeMin = calculateKerbyTimeMin(kerbyLengthFt, surface.n, path.nonchannelSlope);
    const kirpichTimeMin = calculateKirpichTimeMin(kirpichLengthFt, overallSlope(path));
    const warnings = [];
    if (kerbyLimitFt > 1200) warnings.push("Kerby length was capped at 1,200 ft.");
    return {
      pathId: path.pathId,
      method: "Kerby-Kirpich",
      surface: surface.label,
      kerbySurfaceKey,
      kerbySurface: surface.label,
      kerbyN: surface.n,
      kerbyLengthFt,
      kirpichLengthFt,
      kerbyTimeMin,
      kirpichTimeMin,
      totalTimeMin: kerbyTimeMin + kirpichTimeMin,
      warnings
    };
  }

  function rankResults(results) {
    const ranked = results.map(item => ({ ...item }));
    const order = ranked.map((item, index) => ({ index, value: item.totalTimeMin })).sort((a, b) => b.value - a.value);
    order.forEach((entry, i) => {
      ranked[entry.index].rank = i + 1;
      ranked[entry.index].isControlling = i === 0;
    });
    return ranked.sort((a, b) => a.pathId - b.pathId);
  }

  function calculateMethodResults(options = {}) {
    const method = options.method ?? "tr55";
    const sheetSurfaceKeys = { ...DEFAULT_SHEET_SURFACE_KEYS, ...(options.sheetSurfaceKeys ?? {}) };
    const shallowSurfaceKeys = { ...DEFAULT_SHALLOW_SURFACE_KEYS, ...(options.shallowSurfaceKeys ?? {}) };
    const kerbySurfaceKeys = { ...DEFAULT_KERBY_SURFACE_KEYS, ...(options.kerbySurfaceKeys ?? {}) };
    const raw = Object.values(FLOW_PATHS).map(path => {
      if (method === "tr55") {
        return calculateTr55Path(path, {
          sheetLimitFt: options.sheetLimitFt ?? 100,
          shallowLimitFt: options.shallowLimitFt ?? 2000,
          sheetSurfaceKey: sheetSurfaceKeys[path.pathId],
          shallowSurfaceKey: shallowSurfaceKeys[path.pathId],
          channelVelocityFps: options.channelVelocityFps ?? DEFAULT_CHANNEL_VELOCITY_FPS
        });
      }
      if (method === "kerby") {
        return calculateKerbyKirpichPath(path, {
          kerbyLimitFt: options.kerbyLimitFt ?? 1200,
          kerbySurfaceKey: kerbySurfaceKeys[path.pathId]
        });
      }
      throw new Error(`Unsupported method: ${method}`);
    });
    return rankResults(raw);
  }

  function integrateTrapezoid(values, xValues) {
    if (values.length !== xValues.length) throw new Error("Trapezoid arrays must have the same length.");
    let total = 0;
    for (let i = 1; i < values.length; i += 1) total += 0.5 * (values[i - 1] + values[i]) * (xValues[i] - xValues[i - 1]);
    return total;
  }

  function logGamma(z) {
    const coefficients = [
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    let shifted = z - 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < coefficients.length; i += 1) x += coefficients[i] / (shifted + i + 1);
    const t = shifted + coefficients.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function peakRateFactorFromGammaShape(shapeFactorM) {
    assertFinitePositive(shapeFactorM, "Gamma shape factor");
    const logIntegral = shapeFactorM + logGamma(shapeFactorM + 1) - (shapeFactorM + 1) * Math.log(shapeFactorM);
    return 645.33 / Math.exp(logIntegral);
  }

  function solveGammaShapeFactor(peakRateFactor) {
    assertFinitePositive(peakRateFactor, "Peak rate factor");
    let low = 0.01;
    let high = 20;
    if (peakRateFactor < peakRateFactorFromGammaShape(low)) throw new Error("Peak rate factor is below the supported gamma-family range.");
    if (peakRateFactor > peakRateFactorFromGammaShape(high)) throw new Error("Peak rate factor is above the supported gamma-family range.");
    for (let i = 0; i < 90; i += 1) {
      const middle = 0.5 * (low + high);
      if (peakRateFactorFromGammaShape(middle) < peakRateFactor) low = middle;
      else high = middle;
    }
    return 0.5 * (low + high);
  }

  function gammaDimensionlessFlow(timeRatio, shapeFactorM) {
    if (timeRatio <= 0) return 0;
    return Math.exp(shapeFactorM + shapeFactorM * Math.log(timeRatio) - shapeFactorM * timeRatio);
  }

  function makeNrcsUnitHydrograph(tcMin, timestepMin, options = {}) {
    const areaSqmi = Number(options.areaSqmi ?? DRAINAGE_AREA_SQMI);
    const lagRatio = Number(options.lagRatio ?? LAG_RATIO);
    const peakRateFactor = Number(options.peakRateFactor ?? PEAK_RATE_FACTOR);
    assertFinitePositive(tcMin, "Time of concentration");
    assertFinitePositive(timestepMin, "Timestep");
    assertFinitePositive(areaSqmi, "Drainage area");
    if (!(lagRatio > 0 && lagRatio <= 2)) throw new Error("Lag ratio must be positive and reasonable.");

    const timestepHr = timestepMin / 60;
    const lagHr = lagRatio * tcMin / 60;
    const timeToPeakHr = timestepHr / 2 + lagHr;
    const peakCfsPerIn = peakRateFactor * areaSqmi / timeToPeakHr;
    const shapeFactorM = solveGammaShapeFactor(peakRateFactor);
    let durationRatio = 5;
    while (gammaDimensionlessFlow(durationRatio, shapeFactorM) > 1e-5 && durationRatio < 100) durationRatio += 1;
    const durationHr = durationRatio * timeToPeakHr;
    const sampleCount = Math.ceil(durationHr / timestepHr) + 1;
    const unitFlow = new Array(sampleCount);
    const timeSeconds = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      const timeHr = i * timestepHr;
      unitFlow[i] = gammaDimensionlessFlow(timeHr / timeToPeakHr, shapeFactorM) * peakCfsPerIn;
      timeSeconds[i] = timeHr * 3600;
    }
    const oneInchVolumeFt3 = areaSqmi * 5280 * 5280 / 12;
    const computedVolumeFt3 = integrateTrapezoid(unitFlow, timeSeconds);
    if (!(computedVolumeFt3 > 0)) throw new Error("Unit hydrograph has zero volume.");
    const scale = oneInchVolumeFt3 / computedVolumeFt3;
    for (let i = 0; i < unitFlow.length; i += 1) unitFlow[i] *= scale;
    return { unitFlow, lagHr, timeToPeakHr, shapeFactorM };
  }

  const ACTIVE_EXCESS = Object.freeze(EXCESS_IN.map((value, index) => ({ value, index })).filter(item => item.value !== 0));

  function convolveTruncated(signal, kernel, displayCount = signal.length) {
    const output = new Array(displayCount).fill(0);
    const active = signal === EXCESS_IN ? ACTIVE_EXCESS : signal.map((value, index) => ({ value, index })).filter(item => item.value !== 0);
    for (const entry of active) {
      const maxKernel = Math.min(kernel.length, displayCount - entry.index);
      for (let j = 0; j < maxKernel; j += 1) output[entry.index + j] += entry.value * kernel[j];
    }
    return output;
  }

  function peakStats(values) {
    let index = 0;
    let value = -Infinity;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] > value) { value = values[i]; index = i; }
    }
    return { index, value };
  }

  function addHydrographMetrics(results, options = {}) {
    const lagRatio = Number(options.lagRatio ?? LAG_RATIO);
    const peakRateFactor = Number(options.peakRateFactor ?? PEAK_RATE_FACTOR);
    return results.map(result => {
      const unit = makeNrcsUnitHydrograph(result.totalTimeMin, EXCESS_TIMESTEP_MIN, { lagRatio, peakRateFactor });
      const hydrographCfs = convolveTruncated(EXCESS_IN, unit.unitFlow, EXCESS_IN.length);
      const peak = peakStats(hydrographCfs);
      return {
        ...result,
        lagHr: unit.lagHr,
        unitHydrographTpHr: unit.timeToPeakHr,
        hydrographCfs,
        peakFlowCfs: peak.value,
        peakIndex: peak.index,
        peakTimestampMs: EVENT_TIMESTAMPS_MS[peak.index]
      };
    });
  }

  function fixedTransformSensitivityPath() {
    return {
      ...calculateTr55Path(FLOW_PATHS[SENSITIVITY_PATH_ID], {
        sheetLimitFt: SENSITIVITY_SHEET_LIMIT_FT,
        shallowLimitFt: SENSITIVITY_SHALLOW_LIMIT_FT,
        sheetSurfaceKey: DEFAULT_SHEET_SURFACE_KEYS[SENSITIVITY_PATH_ID],
        shallowSurfaceKey: DEFAULT_SHALLOW_SURFACE_KEYS[SENSITIVITY_PATH_ID],
        channelVelocityFps: SENSITIVITY_CHANNEL_VELOCITY_FPS
      }),
      rank: 1,
      isControlling: true
    };
  }

  const transformCaseCache = new Map();
  let transformEnvelopeCache = null;

  function convolveTransformCase(tcMin, lagRatio, peakRateFactor) {
    const key = `${tcMin.toFixed(8)}|${Number(lagRatio).toFixed(2)}|${Number(peakRateFactor)}`;
    if (transformCaseCache.has(key)) return transformCaseCache.get(key);
    const unit = makeNrcsUnitHydrograph(tcMin, EXCESS_TIMESTEP_MIN, { lagRatio, peakRateFactor });
    const hydrographCfs = convolveTruncated(EXCESS_IN, unit.unitFlow, EXCESS_IN.length);
    const peak = peakStats(hydrographCfs);
    const result = Object.freeze({
      lagRatio: Number(lagRatio),
      lagHr: unit.lagHr,
      peakRateFactor: Number(peakRateFactor),
      unitHydrographTpHr: unit.timeToPeakHr,
      hydrographCfs: Object.freeze(hydrographCfs),
      peakFlowCfs: peak.value,
      peakIndex: peak.index,
      peakTimestampMs: EVENT_TIMESTAMPS_MS[peak.index]
    });
    transformCaseCache.set(key, result);
    return result;
  }

  function getTransformEnvelope() {
    if (transformEnvelopeCache) return transformEnvelopeCache;
    const basePath = fixedTransformSensitivityPath();
    const tcMin = basePath.totalTimeMin;
    const minimum = new Array(EXCESS_IN.length).fill(Infinity);
    const maximum = new Array(EXCESS_IN.length).fill(-Infinity);
    let minimumPeakCfs = Infinity;
    let maximumPeakCfs = -Infinity;
    let solutionCount = 0;
    for (const lagRatio of LAG_RATIO_OPTIONS) {
      for (const peakRateFactor of PEAK_RATE_FACTOR_OPTIONS) {
        const item = convolveTransformCase(tcMin, lagRatio, peakRateFactor);
        minimumPeakCfs = Math.min(minimumPeakCfs, item.peakFlowCfs);
        maximumPeakCfs = Math.max(maximumPeakCfs, item.peakFlowCfs);
        for (let i = 0; i < item.hydrographCfs.length; i += 1) {
          minimum[i] = Math.min(minimum[i], item.hydrographCfs[i]);
          maximum[i] = Math.max(maximum[i], item.hydrographCfs[i]);
        }
        solutionCount += 1;
      }
    }
    transformEnvelopeCache = Object.freeze({
      basePath: Object.freeze(basePath),
      envelopeMinCfs: Object.freeze(minimum),
      envelopeMaxCfs: Object.freeze(maximum),
      minimumPeakCfs,
      maximumPeakCfs,
      solutionCount
    });
    return transformEnvelopeCache;
  }

  function calculateTransformSensitivity(selectedLagRatio, selectedPeakRateFactor) {
    const lag = Number(Number(selectedLagRatio).toFixed(2));
    const prf = Number(selectedPeakRateFactor);
    if (!LAG_RATIO_OPTIONS.includes(lag)) throw new Error("Lag ratio must be between 0.50 and 0.70 in 0.01 increments.");
    if (!PEAK_RATE_FACTOR_OPTIONS.includes(prf)) throw new Error("Peak rate factor is not one of the supported selections.");
    const envelope = getTransformEnvelope();
    const selected = convolveTransformCase(envelope.basePath.totalTimeMin, lag, prf);
    return { ...envelope, selected };
  }

  validateFlowPaths();

  return Object.freeze({
    BUILD_VERSION,
    COLORS,
    PATH_COLORS,
    DRAINAGE_AREA_SQMI,
    REMOVED_COMMON_CHANNEL_LENGTH_FT,
    P2_24HR_IN,
    DEFAULT_CHANNEL_VELOCITY_FPS,
    LAG_RATIO,
    PEAK_RATE_FACTOR,
    EXCESS_TIMESTEP_MIN,
    TOTAL_EXCESS_IN,
    EVENT_START_UTC_MS,
    EVENT_TIMESTAMPS_MS,
    EXCESS_IN,
    LAG_RATIO_OPTIONS,
    PEAK_RATE_FACTOR_OPTIONS,
    TR55_SHEET_OPTIONS_FT,
    TR55_SHALLOW_OPTIONS_FT,
    KERBY_LENGTH_OPTIONS_FT,
    SHEET_FLOW_SURFACES,
    SHALLOW_FLOW_SURFACES,
    KERBY_SURFACES,
    DEFAULT_SHEET_SURFACE_KEYS,
    DEFAULT_SHALLOW_SURFACE_KEYS,
    DEFAULT_KERBY_SURFACE_KEYS,
    FLOW_PATHS,
    overallSlope,
    validateFlowPaths,
    calculateSheetTimeMin,
    calculateShallowVelocityFps,
    calculateTravelTimeMin,
    calculateTr55Path,
    calculateKerbyTimeMin,
    calculateKirpichTimeMin,
    calculateKerbyKirpichPath,
    rankResults,
    calculateMethodResults,
    integrateTrapezoid,
    peakRateFactorFromGammaShape,
    solveGammaShapeFactor,
    gammaDimensionlessFlow,
    makeNrcsUnitHydrograph,
    convolveTruncated,
    peakStats,
    addHydrographMetrics,
    fixedTransformSensitivityPath,
    convolveTransformCase,
    calculateTransformSensitivity
  });
});
