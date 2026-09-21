// Scenario-driven Modified Puls quality-control training model.
// Owns training data and evaluation rules only; it performs no DOM manipulation.

import { route, peakStats } from "./routing.js?v=66efa149";

export const QC_RESULT = Object.freeze({
  ACCEPTABLE: "acceptable",
  CLOSE: "close",
  INCORRECT: "materially-incorrect",
  INVALID: "invalid",
});

export const REACH = Object.freeze({
  name: "MP Reach 03",
  upstream: "Junction 12",
  downstream: "Junction 13",
  upstreamStation: "155+00",
  downstreamStation: "113+50",
  condition: "Proposed",
  reachLengthFt: 4150,
});

export const CURVES = Object.freeze([
  Object.freeze({
    id: "MP03",
    reachLimits: "Junction 12 to Junction 13",
    stations: "155+00 to 113+50",
    condition: "Existing",
    geometryRevision: "Existing Geometry Rev. 6",
    sourceModel: "Silver Creek Existing Conditions Model",
    diagnostic: "This curve represents the existing condition rather than the proposed condition.",
  }),
  Object.freeze({
    id: "MP03_PROP",
    reachLimits: "Junction 12 to Junction 14",
    stations: "155+00 to 101+20",
    condition: "Proposed",
    geometryRevision: "Proposed Geometry Rev. 4",
    sourceModel: "Silver Creek Proposed Conditions Model",
    diagnostic: "The curve name looks similar, but its downstream limit is Junction 14 rather than Junction 13.",
  }),
  Object.freeze({
    id: "MP03_PROP_2",
    reachLimits: "Junction 12 to Junction 13",
    stations: "155+00 to 113+50",
    condition: "Proposed",
    geometryRevision: "Proposed Geometry Rev. 2",
    sourceModel: "Silver Creek Proposed Conditions Model",
    matchesReach: true,
    diagnostic: "This curve matches the defined physical reach and proposed condition.",
  }),
  Object.freeze({
    id: "MP04_PROP",
    reachLimits: "Junction 13 to Junction 14",
    stations: "113+50 to 101+20",
    condition: "Proposed",
    geometryRevision: "Proposed Geometry Rev. 4",
    sourceModel: "Silver Creek Proposed Conditions Model",
    diagnostic: "This curve represents the next downstream reach, not MP Reach 03.",
  }),
  Object.freeze({
    id: "MP03_FINAL",
    reachLimits: "Junction 12 to Junction 13",
    stations: "155+00 to 112+80",
    condition: "Proposed",
    geometryRevision: "Proposed Geometry Rev. 3",
    sourceModel: "Silver Creek Alternatives Model",
    diagnostic: "The station limits do not match: this curve extends 70 feet downstream of the defined reach.",
  }),
]);

export const GEOMETRY_REVIEW = Object.freeze({
  assignedCurveId: "MP03_PROP_2",
  curveRevision: 2,
  currentRevision: 4,
  history: Object.freeze([
    "Proposed Geometry Rev. 2 created",
    "Modified Puls curve generated from Rev. 2",
    "Channel widened and overbank grading revised in Rev. 4",
    "Retaining wall added in Rev. 4",
    "Current hydraulic model set to Rev. 4",
  ]),
  correctAction: "regenerate",
});

export const QC_HYDROGRAPH = Object.freeze({
  timeMin: Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180]),
  inflowCfs: Object.freeze([0, 80, 220, 480, 760, 1030, 1280, 1420, 1340, 1120, 870, 640, 450, 300, 190, 110, 55, 20, 0]),
});

export const GEOMETRY_CURVES = Object.freeze({
  rev2: Object.freeze({
    storageAcft: Object.freeze([0, 10, 24, 43, 68, 98, 135, 178, 228]),
    dischargeCfs: Object.freeze([0, 150, 300, 500, 700, 900, 1200, 1500, 1800]),
  }),
  rev4: Object.freeze({
    storageAcft: Object.freeze([0, 12, 29, 52, 82, 118, 161, 210, 265]),
    dischargeCfs: Object.freeze([0, 160, 325, 535, 750, 980, 1280, 1590, 1900]),
  }),
});

export const RESOLUTION_REVIEW = Object.freeze({
  operatingRangeCfs: Object.freeze([400, 1200]),
  reviewedCurveId: "B",
  curves: Object.freeze({
    A: Object.freeze({
      label: "Curve A (8 points)",
      storageAcft: Object.freeze([0, 38, 85, 125, 155, 169, 175, 220]),
      dischargeCfs: Object.freeze([0, 235, 431, 636, 850, 1050, 1203, 1562]),
    }),
    B: Object.freeze({
      label: "Curve B (11 points)",
      storageAcft: Object.freeze([0, 12, 25, 38, 50, 60, 175, 200, 225, 250, 280]),
      dischargeCfs: Object.freeze([0, 73, 153, 235, 313, 378, 1203, 1400, 1603, 1813, 2072]),
    }),
  }),
});

export const FINAL_REVIEW = Object.freeze({
  selectedCurveId: "MP03_PROP_2",
  curveGeometryRevision: 2,
  currentGeometryRevision: 4,
  resolutionCurveId: "B",
  operatingRangeCfs: Object.freeze([400, 1200]),
  issues: Object.freeze(["stale-geometry", "inadequate-resolution"]),
});

export function curveById(curveId) {
  return CURVES.find((curve) => curve.id === curveId) || null;
}

export function evaluateReachCurve(curveId, decision) {
  const curve = curveById(curveId);
  if (!curve || !decision) return { status: QC_RESULT.INVALID, message: "Select a curve and decide whether it represents the defined reach." };
  if (curve.matchesReach && decision === "accept") {
    return { status: QC_RESULT.ACCEPTABLE, message: "Correct. The curve is traceable to the same physical limits, stations, and proposed condition. Naming conventions help, but they are not sufficient QC." };
  }
  if (!curve.matchesReach && decision === "reject") {
    return { status: QC_RESULT.CLOSE, message: `${curve.diagnostic} Good catch; now select and approve the curve that exactly matches the defined reach.` };
  }
  if (curve.matchesReach) {
    return { status: QC_RESULT.INCORRECT, message: "The metadata matches the defined physical reach and proposed condition. Base the decision on those fields, not on the ambiguous name." };
  }
  return { status: QC_RESULT.INCORRECT, message: `${curve.diagnostic} Do not validate a curve from its dropdown name alone.` };
}

export function evaluateGeometryAction(action) {
  if (!action) return { status: QC_RESULT.INVALID, message: "Choose how the reviewer should address the revision mismatch." };
  if (action === GEOMETRY_REVIEW.correctAction) {
    return { status: QC_RESULT.ACCEPTABLE, message: "Correct. The routing calculation can be mathematically correct while representing obsolete geometry. Regenerate or re-export the curve after changes affecting storage or conveyance." };
  }
  return { status: QC_RESULT.INCORRECT, message: "Keeping the Rev. 2 curve would route through obsolete storage and conveyance assumptions. The curve must be regenerated from the current geometry." };
}

export function evaluateResolution(decision, concern, preferredCurve) {
  if (!decision) return { status: QC_RESULT.INVALID, message: "Decide whether to accept the reviewed curve." };
  if (decision === "accept") return { status: QC_RESULT.INCORRECT, message: "The curve is monotonic, but most of the routed operating range is bridged by one large interpolation interval." };
  if (!concern || !preferredCurve) return { status: QC_RESULT.INVALID, message: "Identify the controlling concern and the better-distributed comparison curve." };
  if (concern !== "operating-range-resolution") {
    return { status: QC_RESULT.INCORRECT, message: "The maximum values are not the controlling issue. Review how the supplied points are distributed through 400–1,200 cfs." };
  }
  if (preferredCurve !== "A") {
    return { status: QC_RESULT.INCORRECT, message: "More total rows do not guarantee better routing support. Curve B clusters points outside the range used by this event." };
  }
  return { status: QC_RESULT.ACCEPTABLE, message: "Correct. Modified Puls interpolates between supplied points. Curve A is preferable because it resolves the operating range, even though it has fewer total rows." };
}

export function evaluateFinalReview(decision, selectedReasons) {
  if (!decision) return { status: QC_RESULT.INVALID, message: "Choose whether to approve or return the review package." };
  if (decision === "approve") return { status: QC_RESULT.INCORRECT, message: "The package contains issues already covered in the geometry-revision and curve-resolution checkpoints. Review those fields before approving." };
  const selected = new Set(selectedReasons || []);
  if (!selected.size) return { status: QC_RESULT.INVALID, message: "Identify the reasons for returning the package." };
  const missing = FINAL_REVIEW.issues.filter((issue) => !selected.has(issue));
  const extra = [...selected].filter((issue) => !FINAL_REVIEW.issues.includes(issue));
  if (extra.length) return { status: QC_RESULT.INCORRECT, message: "One selected reason is not supported by the package. Limit the review to documented reach, geometry, and curve-resolution evidence." };
  if (missing.length) return { status: QC_RESULT.CLOSE, message: "You identified a valid issue, but another previously taught QC problem remains in the package." };
  return { status: QC_RESULT.ACCEPTABLE, message: "Correct. Return the package because the curve is stale and inadequately resolved through the routed range. The physical reach is supported by the supplied metadata." };
}

export function geometryComparison() {
  const oldRoute = route(QC_HYDROGRAPH.timeMin, QC_HYDROGRAPH.inflowCfs, GEOMETRY_CURVES.rev2.storageAcft, GEOMETRY_CURVES.rev2.dischargeCfs);
  const currentRoute = route(QC_HYDROGRAPH.timeMin, QC_HYDROGRAPH.inflowCfs, GEOMETRY_CURVES.rev4.storageAcft, GEOMETRY_CURVES.rev4.dischargeCfs);
  return Object.freeze({
    timeMin: QC_HYDROGRAPH.timeMin,
    inflowCfs: QC_HYDROGRAPH.inflowCfs,
    oldOutflowCfs: Object.freeze(oldRoute.outflow),
    currentOutflowCfs: Object.freeze(currentRoute.outflow),
    oldPeak: Object.freeze(peakStats(QC_HYDROGRAPH.timeMin, oldRoute.outflow)),
    currentPeak: Object.freeze(peakStats(QC_HYDROGRAPH.timeMin, currentRoute.outflow)),
  });
}

export function finalReviewRouting() {
  const routed = route(QC_HYDROGRAPH.timeMin, QC_HYDROGRAPH.inflowCfs, GEOMETRY_CURVES.rev2.storageAcft, GEOMETRY_CURVES.rev2.dischargeCfs);
  return Object.freeze({
    timeMin: QC_HYDROGRAPH.timeMin,
    inflowCfs: QC_HYDROGRAPH.inflowCfs,
    outflowCfs: Object.freeze(routed.outflow),
  });
}
