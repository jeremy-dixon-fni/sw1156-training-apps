// Modified Puls Teaching Companion — app orchestration.
// Owns state, wires the left rail + tabs + stepper, computes routing, and keeps the URL hash in sync.

import { PRESETS, DEFAULT_PRESET_ID } from "./presets.js";
import {
  routeBothCases, peakStats, attenuationAndLag, continuitySummary, firstClampTime,
} from "./routing.js";
import { buildSteps } from "./steps.js";
import { parseHydrograph, parseStorageDischarge, hydrographToCsv, storageDischargeToCsv } from "./csv.js";
import {
  drawConcept, drawResultHydro, drawCurve, drawMechCurve, drawGeometryCurveComparison,
  drawGeometryHydroComparison, drawResolutionComparison, drawFinalReviewHydro,
  drawFinalReviewCurve, resize,
} from "./charts.js";
import * as QC from "./qc.js";

const Checkpoints = window.TrainingCheckpoints;
if (!Checkpoints) throw new Error("The shared checkpoint framework must load before app.js.");

const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
const CUSTOM_ID = "custom";

const state = {
  presetId: DEFAULT_PRESET_ID,
  multiplier: 1.0,
  act: 1,
  step: 0,
  // Uploaded data lives in its own dropdown entry instead of overwriting a preset.
  custom: null, // { hydro, curve, hydroName, curveName, baseLabel }
  checkpointFlow: null,
};

let computed = null; // { result, steps, hydro, curve, error }

const $ = (id) => document.getElementById(id);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const fmt0 = (x) => fmt(x, 0);

// ---------- data resolution ----------
function activeData() {
  if (state.presetId === CUSTOM_ID && state.custom) return state.custom;
  return PRESET_BY_ID[state.presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID];
}
function currentHydro() {
  return activeData().hydro;
}
function currentCurve() {
  return activeData().curve;
}
function isCustom() {
  return state.presetId === CUSTOM_ID && !!state.custom;
}

function recompute() {
  try {
    const hydro = currentHydro();
    const curve = currentCurve();
    const result = routeBothCases(hydro, curve, state.multiplier);
    const modifiedCurve = {
      storageAcft: curve.storageAcft.map((s) => s * state.multiplier),
      dischargeCfs: curve.dischargeCfs,
    };
    const steps = buildSteps(hydro, modifiedCurve);
    if (state.step > steps.rows.length - 1) state.step = steps.rows.length - 1;
    if (state.step < 0) state.step = 0;
    computed = { result, steps, hydro, curve, error: null };
  } catch (err) {
    computed = { error: err.message || String(err) };
  }
}

// ---------- rendering ----------
function renderStatus() {
  const el = $("status");
  if (computed.error) {
    el.classList.add("error");
    el.innerHTML = `<h2>Input error</h2><p>${computed.error}</p>`;
    return;
  }
  el.classList.remove("error");
  const dt = computed.hydro.timeMin[1] - computed.hydro.timeMin[0];
  const src = isCustom() ? "your uploaded data" : `preset: ${activeData().label}`;
  el.innerHTML = `<h2>Ready</h2><p>Routing ${src}. Detected time step Δt = ${dt} min, storage multiplier ${state.multiplier.toFixed(2)}.</p>`;
  $("dt-readout").textContent = `${dt} min`;
}

function renderConcept() {
  const { result } = computed;
  drawConcept("concept-plot", result);
  const al = attenuationAndLag(result.timeMin, result.inflowCfs, result.modifiedOutflowCfs);
  $("concept-atten").textContent = `${al.attenuationPct.toFixed(1)}%`;
  $("concept-lag").textContent = `${fmt0(al.lagMin)} min`;
  resize("concept-plot");
}

function renderMechanics() {
  const { steps } = computed;
  const k = state.step;
  let html = "<thead><tr><th>t (min)</th><th>I₁+I₂</th><th>2S/Δt+O</th><th>O (cfs)</th><th>S (ac-ft)</th></tr></thead><tbody>";
  steps.rows.forEach((r, i) => {
    const cls = (i === k ? "active" : "") + (r.clamped ? " clamped" : "");
    html += `<tr class="${cls.trim()}"><td>${fmt0(r.tMin)}</td><td>${r.inflowSum == null ? "—" : fmt(r.inflowSum, 1)}</td>` +
      `<td>${r.rhs == null ? "—" : fmt(r.rhs, 1)}</td><td>${fmt(r.outflowCfs, 2)}</td><td>${fmt(r.storageAcft, 2)}</td></tr>`;
  });
  html += "</tbody>";
  $("mech-table").innerHTML = html;
  const activeRow = $("mech-table").querySelector("tr.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest" });

  const r = steps.rows[k];
  if (k === 0) {
    $("mech-eqn").innerHTML = `<b>Initial condition</b> at t = ${fmt0(r.tMin)} min: O = <b>${fmt(r.outflowCfs, 2)} cfs</b>, S = <b>${fmt(r.storageAcft, 2)} ac-ft</b>.`;
  } else {
    $("mech-eqn").innerHTML =
      `2S₂/Δt + O₂ = (I₁ + I₂) + (2S₁/Δt − O₁) = (${fmt(r.i1, 1)} + ${fmt(r.i2, 1)}) + (${fmt(r.prevTermRhs, 1)}) = <b>${fmt(r.rhs, 1)}</b>` +
      `<br>read off the curve → O₂ = <b>${fmt(r.outflowCfs, 2)} cfs</b>, S₂ = <b>${fmt(r.storageAcft, 2)} ac-ft</b>` +
      (r.clamped ? ` <span style="color:var(--orange)">(beyond the curve — clamped)</span>` : "");
  }

  drawMechCurve("mech-curve", steps, k);
  let counter = `Step ${k} of ${steps.rows.length - 1} · t = ${fmt0(r.tMin)} min`;
  if (steps.sampled) counter += ` · representative steps from ${steps.totalSteps} timesteps`;
  $("step-counter").textContent = counter;
  resize("mech-curve");
}

function metricCard(title, value, sub) {
  return `<div class="title">${title}</div><div class="value">${value}</div><div class="sub">${sub}</div>`;
}

function renderResult() {
  const { result, curve } = computed;
  drawResultHydro("result-hydro", result);
  drawCurve("result-curve", curve, state.multiplier);

  const pin = peakStats(result.timeMin, result.inflowCfs);
  const pout = peakStats(result.timeMin, result.outflowCfs);
  const pmod = peakStats(result.timeMin, result.modifiedOutflowCfs);
  const alOut = attenuationAndLag(result.timeMin, result.inflowCfs, result.outflowCfs);
  const alMod = attenuationAndLag(result.timeMin, result.inflowCfs, result.modifiedOutflowCfs);
  const cont = continuitySummary(result);

  $("m-inflow").innerHTML = metricCard("Peak Inflow", `${fmt(pin.peak, 0)} cfs`, `at ${fmt0(pin.time)} min`);
  $("m-outflow").innerHTML = metricCard("Peak Outflow", `${fmt(pout.peak, 0)} cfs`, `${alOut.attenuationPct.toFixed(0)}% atten, ${fmt0(alOut.lagMin)} min lag`);
  $("m-modified").innerHTML = metricCard("Peak Modified", `${fmt(pmod.peak, 0)} cfs`, `${alMod.attenuationPct.toFixed(0)}% atten, ${fmt0(alMod.lagMin)} min lag`);
  $("m-volume").innerHTML = metricCard("Volume Balance", `${cont.residualPct >= 0 ? "+" : ""}${cont.residualPct.toFixed(2)}%`, `in ${fmt(cont.vIn, 1)} vs out ${fmt(cont.vOut, 1)} ac-ft`);

  const pstore = peakStats(result.timeMin, result.storageAcft);
  const pmstore = peakStats(result.timeMin, result.modifiedStorageAcft);
  const rows = [
    ["Inflow", pin, "—", "—"],
    ["Outflow", pout, alOut.attenuationPct.toFixed(1), fmt0(alOut.lagMin)],
    ["Modified Outflow", pmod, alMod.attenuationPct.toFixed(1), fmt0(alMod.lagMin)],
    ["Storage", pstore, "—", "—"],
    ["Modified Storage", pmstore, "—", "—"],
  ];
  let html = "<thead><tr><th>Series</th><th>Peak</th><th>Time of peak (min)</th><th>Attenuation (%)</th><th>Lag (min)</th></tr></thead><tbody>";
  for (const [name, ps, att, lag] of rows) {
    html += `<tr><td>${name}</td><td>${fmt(ps.peak, 2)}</td><td>${fmt0(ps.time)}</td><td>${att}</td><td>${lag}</td></tr>`;
  }
  html += "</tbody>";
  $("result-table").innerHTML = html;

  const ct = firstClampTime(result);
  let notes = `Continuity residual is <b>${cont.residualPct.toFixed(2)}%</b> — inflow volume equals outflow volume plus the change in storage, which is the proof the routing conserved mass.`;
  if (ct !== null) {
    notes += `<br><span class="clamp">The event reached the top of the storage-discharge curve at t = ${fmt0(ct)} min; results past that point are clamped. Extend the curve to capture the full event.</span>`;
  }
  $("result-notes").innerHTML = notes;
  resize("result-hydro");
  resize("result-curve");
}

function renderActive() {
  renderStatus();
  for (const a of [1, 2, 3]) $(`act-${a}`).hidden = a !== state.act || !!computed.error;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", Number(t.dataset.act) === state.act));
  if (computed.error) return;
  if (state.act === 1) renderConcept();
  else if (state.act === 2) renderMechanics();
  else renderResult();
}

// ---------- URL hash ----------
function writeHash() {
  const h = `#preset=${state.presetId}&mult=${state.multiplier.toFixed(2)}&act=${state.act}&step=${state.step}`;
  history.replaceState(null, "", h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const preset = h.get("preset");
  if (preset && PRESET_BY_ID[preset]) state.presetId = preset; // custom can't be restored from a link
  const mult = parseFloat(h.get("mult"));
  if (Number.isFinite(mult) && mult >= 0.1 && mult <= 3.0) state.multiplier = mult;
  const act = parseInt(h.get("act"), 10);
  if (act >= 1 && act <= 3) state.act = act;
  const step = parseInt(h.get("step"), 10);
  if (Number.isFinite(step) && step >= 0) state.step = step;
}

// ---------- rail helpers ----------
function rebuildPresetOptions() {
  const sel = $("preset-select");
  const opts = PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`);
  if (state.custom) opts.push(`<option value="${CUSTOM_ID}">★ Your uploaded data</option>`);
  sel.innerHTML = opts.join("");
  sel.value = state.presetId;
}

function updateRailText() {
  if (isCustom()) {
    $("preset-blurb").textContent =
      "Your uploaded data. Upload a hydrograph and/or a storage-discharge CSV; whichever you don't upload keeps the example you started from.";
    $("hydro-name").textContent = state.custom.hydroName ? `Hydrograph: ${state.custom.hydroName}` : `Hydrograph: from “${state.custom.baseLabel}”`;
    $("curve-name").textContent = state.custom.curveName ? `Curve: ${state.custom.curveName}` : `Curve: from “${state.custom.baseLabel}”`;
  } else {
    $("preset-blurb").textContent = activeData().blurb;
    $("hydro-name").textContent = "Using preset hydrograph.";
    $("curve-name").textContent = "Using preset storage-discharge curve.";
  }
}

function ensureCustom() {
  if (!state.custom) {
    const base = PRESET_BY_ID[state.presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID];
    state.custom = { hydro: base.hydro, curve: base.curve, hydroName: null, curveName: null, baseLabel: base.label };
  }
}

// ---------- events ----------
function refresh() {
  recompute();
  renderActive();
  writeHash();
}

function initRail() {
  rebuildPresetOptions();
  updateRailText();
  $("mult-slider").value = state.multiplier;
  $("mult-out").textContent = state.multiplier.toFixed(2);

  $("preset-select").addEventListener("change", (e) => {
    state.presetId = e.target.value;
    state.step = 0;
    updateRailText();
    refresh();
  });

  $("mult-slider").addEventListener("input", (e) => {
    state.multiplier = parseFloat(e.target.value);
    $("mult-out").textContent = state.multiplier.toFixed(2);
    refresh();
  });

  $("upload-hydro").addEventListener("change", (e) => handleUpload(e, true));
  $("upload-curve").addEventListener("change", (e) => handleUpload(e, false));

  $("reset-data").addEventListener("click", () => {
    state.custom = null;
    state.presetId = DEFAULT_PRESET_ID;
    state.step = 0;
    rebuildPresetOptions();
    updateRailText();
    refresh();
  });

  $("share-btn").addEventListener("click", () => {
    writeHash();
    navigator.clipboard.writeText(location.href).then(() => {
      const note = isCustom()
        ? "Link copied — note: uploaded data isn't included in the link (it stays on this device)."
        : "Link copied to clipboard.";
      $("share-status").textContent = note;
      setTimeout(() => ($("share-status").textContent = ""), 4000);
    });
  });

  $("dl-hydro").addEventListener("click", (e) => { e.preventDefault(); download("hydrograph.csv", hydrographToCsv(currentHydro())); });
  $("dl-curve").addEventListener("click", (e) => { e.preventDefault(); download("storage_discharge.csv", storageDischargeToCsv(currentCurve())); });
}

function handleUpload(e, isHydro) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = isHydro ? parseHydrograph(reader.result) : parseStorageDischarge(reader.result);
      ensureCustom();
      if (isHydro) { state.custom.hydro = parsed; state.custom.hydroName = file.name; }
      else { state.custom.curve = parsed; state.custom.curveName = file.name; }
      state.presetId = CUSTOM_ID;
      state.step = 0;
      rebuildPresetOptions();
      updateRailText();
      refresh();
    } catch (err) {
      (isHydro ? $("hydro-name") : $("curve-name")).textContent = `Error: ${err.message}`;
    } finally {
      e.target.value = ""; // allow re-uploading the same filename
    }
  };
  reader.readAsText(file);
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      state.act = Number(t.dataset.act);
      renderActive();
      writeHash();
    });
  });
  $("step-prev").addEventListener("click", () => { stopPlay(); state.step = Math.max(0, state.step - 1); renderMechanics(); writeHash(); });
  $("step-next").addEventListener("click", () => { stopPlay(); stepNext(); });
  $("step-play").addEventListener("click", togglePlay);
}

function stepNext() {
  const max = computed.steps.rows.length - 1;
  state.step = Math.min(max, state.step + 1);
  renderMechanics();
  writeHash();
}

let playTimer = null;
function togglePlay() {
  if (playTimer) return stopPlay();
  $("step-play").textContent = "⏸ Pause";
  playTimer = setInterval(() => {
    const max = computed.steps.rows.length - 1;
    if (state.step >= max) return stopPlay();
    stepNext();
  }, 450);
}
function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  $("step-play").textContent = "▶▶ Auto-play";
}

// ---------- QC checkpoint training ----------
function detailGrid(entries) {
  return `<dl class="qc-detail-grid">${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function checkedValue(name) {
  const selected = document.querySelector(`input[name="${name}"]:checked`);
  return selected ? selected.value : "";
}

function renderReachDefinition() {
  const reach = QC.REACH;
  return `<section class="qc-scenario-card reach-definition"><h3>Reach Definition</h3>${detailGrid([
    ["Name", reach.name],
    ["Upstream", reach.upstream],
    ["Downstream", reach.downstream],
    ["Stations", `${reach.upstreamStation} to ${reach.downstreamStation}`],
    ["Condition", reach.condition],
    ["Reach length", `${reach.reachLengthFt.toLocaleString()} ft`],
  ])}</section>`;
}

function renderCurveMetadata(curve) {
  if (!curve) return `<p class="muted">Select a curve to inspect its source metadata.</p>`;
  return detailGrid([
    ["Curve name", curve.id],
    ["Reach limits", curve.reachLimits],
    ["Stations", curve.stations],
    ["Condition", curve.condition],
    ["Geometry source", curve.geometryRevision],
    ["Source hydraulic model", curve.sourceModel],
  ]);
}

function resetExplorer() {
  stopPlay();
  state.presetId = DEFAULT_PRESET_ID;
  state.multiplier = 1;
  state.act = 1;
  state.step = 0;
  state.custom = null;
  rebuildPresetOptions();
  updateRailText();
  $("mult-slider").value = "1";
  $("mult-out").textContent = "1.00";
  refresh();
}

function initializeCheckpoints() {
  const checkpoints = [
    {
      id: "reach-and-curve",
      title: "Define the reach and verify the curve",
      task: "Identify the physical routing reach, then verify that the selected storage-discharge curve represents those same limits and condition.",
      render: (body) => {
        body.className = "checkpoint-body qc-checkpoint-body";
        body.innerHTML = `
          <div class="qc-two-col">
            ${renderReachDefinition()}
            <section class="qc-scenario-card">
              <h3>Curve Selection</h3>
              <label class="control-label" for="qc-curve-select">Assigned storage-discharge curve</label>
              <select id="qc-curve-select" class="qc-control">
                <option value="">Select a curve</option>
                ${QC.CURVES.map((curve) => `<option value="${curve.id}">${curve.id}</option>`).join("")}
              </select>
              <h4>Selected Curve Information</h4>
              <div id="qc-curve-metadata">${renderCurveMetadata(null)}</div>
            </section>
          </div>
          <fieldset class="qc-decision"><legend>Does this storage-discharge curve represent the physical reach defined above?</legend>
            <label><input type="radio" name="qc-reach-decision" value="accept"> Accept</label>
            <label><input type="radio" name="qc-reach-decision" value="reject"> Reject / wrong curve</label>
          </fieldset>`;
        const select = $("qc-curve-select");
        select.addEventListener("change", () => {
          $("qc-curve-metadata").innerHTML = renderCurveMetadata(QC.curveById(select.value));
        });
      },
      evaluate: () => QC.evaluateReachCurve($("qc-curve-select").value, checkedValue("qc-reach-decision")),
      takeaway: "A routing curve should be traceable to a specific physical reach. Naming conventions are helpful, but they are not sufficient QC.",
    },
    {
      id: "geometry-revision",
      title: "Verify the curve represents current geometry",
      task: "Determine whether a curve generated before meaningful geometry revisions can remain assigned to the current model.",
      render: (body) => {
        body.className = "checkpoint-body qc-checkpoint-body";
        body.innerHTML = `
          <div class="qc-two-col">
            <section class="qc-scenario-card"><h3>Revision History</h3><ol class="revision-list">${QC.GEOMETRY_REVIEW.history.map((item, index) => `<li class="${index === 1 ? "curve-created" : index >= 2 ? "later-change" : ""}">${item}</li>`).join("")}</ol></section>
            <section class="qc-scenario-card"><h3>Review Finding</h3>${detailGrid([
              ["Assigned curve", QC.GEOMETRY_REVIEW.assignedCurveId],
              ["Curve geometry", `Proposed Geometry Rev. ${QC.GEOMETRY_REVIEW.curveRevision}`],
              ["Current model", `Proposed Geometry Rev. ${QC.GEOMETRY_REVIEW.currentRevision}`],
              ["Meaningful changes", "Channel widening, overbank grading, and retaining wall"],
            ])}</section>
          </div>
          <fieldset class="qc-decision"><legend>The curve was generated from Rev. 2 geometry and the model is now Rev. 4. What should you do?</legend>
            <label><input type="radio" name="qc-geometry-action" value="keep"> Keep the existing curve</label>
            <label><input type="radio" name="qc-geometry-action" value="regenerate"> Regenerate / re-export the storage-discharge curve</label>
          </fieldset>
          <section id="qc-geometry-reveal" class="qc-reveal" hidden>
            <h3>Revision comparison</h3>
            <p>The change is realistic but visible: the same inflow produces different routing when current storage and conveyance are used.</p>
            <div class="qc-plot-grid"><div><h4>Storage-discharge curves</h4><div id="qc-geometry-curves" class="qc-plot"></div></div><div><h4>Resulting routed hydrographs</h4><div id="qc-geometry-hydro" class="qc-plot"></div></div></div>
            <p id="qc-geometry-metrics" class="qc-chart-note"></p>
          </section>`;
      },
      evaluate: () => {
        const result = QC.evaluateGeometryAction(checkedValue("qc-geometry-action"));
        if (result.status === QC.QC_RESULT.ACCEPTABLE) {
          const comparison = QC.geometryComparison();
          $("qc-geometry-reveal").hidden = false;
          drawGeometryCurveComparison("qc-geometry-curves", QC.GEOMETRY_CURVES);
          drawGeometryHydroComparison("qc-geometry-hydro", comparison);
          $("qc-geometry-metrics").textContent = `Rev. 2 routed peak: ${fmt0(comparison.oldPeak.peak)} cfs; Rev. 4 routed peak: ${fmt0(comparison.currentPeak.peak)} cfs.`;
        }
        return result;
      },
      takeaway: "When geometry affecting storage or conveyance changes, verify that the Modified Puls curve was regenerated.",
    },
    {
      id: "curve-resolution",
      title: "Review curve resolution through the routed range",
      task: "Determine whether the supplied points adequately define the portion of the storage-discharge curve actually used by the event.",
      render: (body) => {
        body.className = "checkpoint-body qc-checkpoint-body";
        body.innerHTML = `
          <section class="qc-scenario-card">
            <h3>Curve Resolution Review</h3>
            <p>The event routes primarily between <strong>${QC.RESOLUTION_REVIEW.operatingRangeCfs[0].toLocaleString()} and ${QC.RESOLUTION_REVIEW.operatingRangeCfs[1].toLocaleString()} cfs</strong>. Curve B is the curve currently assigned for review.</p>
            <div id="qc-resolution-plot" class="qc-plot wide"></div>
          </section>
          <fieldset class="qc-decision"><legend>Would you accept Curve B for routing this event?</legend>
            <label><input type="radio" name="qc-resolution-decision" value="accept"> Accept</label>
            <label><input type="radio" name="qc-resolution-decision" value="reject"> Reject</label>
          </fieldset>
          <div id="qc-resolution-followup" class="qc-followup" hidden>
            <label class="control-label" for="qc-resolution-concern">Primary concern</label>
            <select id="qc-resolution-concern" class="qc-control">
              <option value="">Select a concern</option>
              <option value="operating-range-resolution">Too few points through the routed operating range</option>
              <option value="max-storage">Maximum storage is too high</option>
              <option value="max-discharge">Maximum discharge is too high</option>
              <option value="none">No problem</option>
            </select>
            <fieldset class="qc-decision compact"><legend>Which curve is better suited to this event?</legend>
              <label><input type="radio" name="qc-preferred-curve" value="A"> Curve A</label>
              <label><input type="radio" name="qc-preferred-curve" value="B"> Curve B</label>
            </fieldset>
          </div>`;
        drawResolutionComparison("qc-resolution-plot", QC.RESOLUTION_REVIEW);
        document.querySelectorAll('input[name="qc-resolution-decision"]').forEach((input) => input.addEventListener("change", () => {
          const rejecting = input.checked && input.value === "reject";
          $("qc-resolution-followup").hidden = !rejecting;
          if (!rejecting) {
            $("qc-resolution-concern").value = "";
            document.querySelectorAll('input[name="qc-preferred-curve"]').forEach((choice) => { choice.checked = false; });
          }
        }));
      },
      evaluate: () => QC.evaluateResolution(
        checkedValue("qc-resolution-decision"),
        $("qc-resolution-concern").value,
        checkedValue("qc-preferred-curve"),
      ),
      takeaway: "Point distribution through the operating range matters more than total row count because Modified Puls interpolates between supplied points.",
    },
    {
      id: "final-review",
      title: "Complete the integrated QC review",
      task: "Review the package using only the reach, revision, and curve-resolution checks covered in the preceding checkpoints.",
      render: (body) => {
        const review = QC.FINAL_REVIEW;
        const curve = QC.curveById(review.selectedCurveId);
        body.className = "checkpoint-body qc-checkpoint-body";
        body.innerHTML = `
          <section class="qc-review-package">
            <h3>Modified Puls Review Package</h3>
            <div class="qc-package-grid">
              <div>${renderReachDefinition()}</div>
              <section class="qc-scenario-card"><h4>Assigned Curve</h4>${detailGrid([
                ["Curve", curve.id], ["Reach limits", curve.reachLimits], ["Condition", curve.condition],
                ["Curve geometry", `Rev. ${review.curveGeometryRevision}`], ["Current geometry", `Rev. ${review.currentGeometryRevision}`],
              ])}</section>
              <section class="qc-scenario-card"><h4>Curve Coverage</h4>${detailGrid([
                ["Curve", review.resolutionCurveId], ["Total supplied points", QC.RESOLUTION_REVIEW.curves.B.storageAcft.length],
                ["Routed operating range", `${review.operatingRangeCfs[0].toLocaleString()}–${review.operatingRangeCfs[1].toLocaleString()} cfs`],
              ])}</section>
            </div>
            <div class="qc-plot-grid"><div><h4>Assigned storage-discharge curve</h4><div id="qc-final-curve" class="qc-plot"></div></div><div><h4>Resulting routed hydrograph</h4><div id="qc-final-hydro" class="qc-plot"></div></div></div>
          </section>
          <fieldset class="qc-decision"><legend>Would you approve this Modified Puls routing setup or return it for correction?</legend>
            <label><input type="radio" name="qc-final-decision" value="approve"> Approve</label>
            <label><input type="radio" name="qc-final-decision" value="return"> Return for correction</label>
          </fieldset>
          <fieldset id="qc-final-reasons" class="qc-decision reason-list" hidden><legend>Reason(s) for returning the package</legend>
            <label><input type="checkbox" value="wrong-reach"> Selected curve represents the wrong physical reach</label>
            <label><input type="checkbox" value="stale-geometry"> Curve was generated from obsolete geometry</label>
            <label><input type="checkbox" value="inadequate-resolution"> Curve is inadequately resolved through the routed range</label>
          </fieldset>`;
        drawFinalReviewCurve("qc-final-curve", QC.RESOLUTION_REVIEW.curves.B, review.operatingRangeCfs);
        drawFinalReviewHydro("qc-final-hydro", QC.finalReviewRouting());
        document.querySelectorAll('input[name="qc-final-decision"]').forEach((input) => input.addEventListener("change", () => {
          const returning = input.checked && input.value === "return";
          $("qc-final-reasons").hidden = !returning;
          if (!returning) $("qc-final-reasons").querySelectorAll("input").forEach((reason) => { reason.checked = false; });
        }));
      },
      evaluate: () => QC.evaluateFinalReview(
        checkedValue("qc-final-decision"),
        [...$("qc-final-reasons").querySelectorAll("input:checked")].map((input) => input.value),
      ),
      takeaway: "A defensible routed hydrograph begins with a defensible reach, current geometry, and adequate operating-range resolution.",
    },
  ];

  state.checkpointFlow = new Checkpoints.CheckpointFlow({
    moduleId: "modified-puls",
    checkpoints,
    elements: {
      number: $("checkpoint-number"), title: $("checkpoint-title"), task: $("checkpoint-task"),
      body: $("checkpoint-body"), feedback: $("checkpoint-feedback"), checkButton: $("checkpoint-check"),
      nextButton: $("checkpoint-next"), resetButton: $("checkpoint-reset"), progress: $("checkpoint-progress"),
      completeMessage: $("checkpoint-complete"),
    },
    onUnlock: (unlocked) => {
      $("sandbox-shell").classList.toggle("is-checkpoint-locked", !unlocked);
      $("sandbox-lock").hidden = unlocked;
      if (unlocked && computed && !computed.error) requestAnimationFrame(renderActive);
    },
    onReset: resetExplorer,
  });
}

window.addEventListener("resize", () => {
  if (computed && !computed.error) {
    if (state.act === 1) resize("concept-plot");
    else if (state.act === 2) resize("mech-curve");
    else { resize("result-hydro"); resize("result-curve"); }
  }
});

// ---------- boot ----------
readHash();
initRail();
initTabs();
refresh();
initializeCheckpoints();
