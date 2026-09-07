/* DOM wiring for the Transform Flow Path Explorer. */
(function (globalScope) {
  "use strict";

  const Model = globalScope.TransformModel;
  const Charts = globalScope.TransformCharts;
  const Checkpoints = globalScope.TrainingCheckpoints;
  if (!Model || !Charts || !Checkpoints) throw new Error("model.js, charts.js, and checkpoints.js must load before app.js.");

  function carriedP2Depth() {
    const value = Number(sessionStorage.getItem("training-transfer:atlas14:2yr24hr-depth-in"));
    return Number.isFinite(value) && value > 0 ? value : 3.95;
  }

  const state = {
    method: "tr55",
    updateTimer: null,
    verifiedP2: Model.P2_24HR_IN,
    checkpointFlow: null,
    checkpointP2Upload: null
  };

  const SURFACE_QC_RESULTS = Object.freeze({
    pavement: Object.freeze({ tcMin: 6.8, peakCfs: 19 }),
    grass: Object.freeze({ tcMin: 12.4, peakCfs: 14 })
  });

  const byId = id => document.getElementById(id);
  const format0 = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const format1 = value => Number(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const format2 = value => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const format3 = value => Number(value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  function formatTimestamp(timestampMs) {
    const value = new Date(timestampMs);
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][value.getUTCMonth()];
    const hour = String(value.getUTCHours()).padStart(2, "0");
    const minute = String(value.getUTCMinutes()).padStart(2, "0");
    return `${day} ${month} ${hour}:${minute}`;
  }

  function makeOption(value, label, selected) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    return option;
  }

  function coefficientOptions(definitions, coefficientKey) {
    return Object.entries(definitions).map(([key, item]) => ({
      key,
      label: `${item.label} (${coefficientKey}=${Number(item[coefficientKey.toLowerCase()]).toLocaleString("en-US", { maximumFractionDigits: 3 })})`
    }));
  }

  function buildSurfaceGrids() {
    const tr55Grid = byId("tr55-surface-grid");
    tr55Grid.replaceChildren();
    ["Path", "Sheet-flow surface", "Shallow-flow surface"].forEach(label => {
      const heading = document.createElement("div");
      heading.className = "grid-heading";
      heading.textContent = label;
      tr55Grid.appendChild(heading);
    });

    const sheetOptions = coefficientOptions(Model.SHEET_FLOW_SURFACES, "n");
    const shallowOptions = coefficientOptions(Model.SHALLOW_FLOW_SURFACES, "k");
    for (const pathId of [1, 2, 3, 4]) {
      const pathLabel = document.createElement("div");
      pathLabel.className = "path-label";
      pathLabel.style.color = Model.PATH_COLORS[pathId];
      pathLabel.textContent = `Path ${pathId}`;
      tr55Grid.appendChild(pathLabel);

      const sheetSelect = document.createElement("select");
      sheetSelect.id = `sheet-surface-${pathId}`;
      sheetSelect.setAttribute("aria-label", `Path ${pathId} sheet-flow surface`);
      sheetOptions.forEach(item => sheetSelect.appendChild(makeOption(item.key, item.label, item.key === Model.DEFAULT_SHEET_SURFACE_KEYS[pathId])));
      tr55Grid.appendChild(sheetSelect);

      const shallowSelect = document.createElement("select");
      shallowSelect.id = `shallow-surface-${pathId}`;
      shallowSelect.setAttribute("aria-label", `Path ${pathId} shallow-concentrated-flow surface`);
      shallowOptions.forEach(item => shallowSelect.appendChild(makeOption(item.key, item.label, item.key === Model.DEFAULT_SHALLOW_SURFACE_KEYS[pathId])));
      tr55Grid.appendChild(shallowSelect);
    }

    const kerbyGrid = byId("kerby-surface-grid");
    kerbyGrid.replaceChildren();
    ["Path", "Kerby overland surface"].forEach(label => {
      const heading = document.createElement("div");
      heading.className = "grid-heading";
      heading.textContent = label;
      kerbyGrid.appendChild(heading);
    });
    const kerbyOptions = coefficientOptions(Model.KERBY_SURFACES, "n");
    for (const pathId of [1, 2, 3, 4]) {
      const pathLabel = document.createElement("div");
      pathLabel.className = "path-label";
      pathLabel.style.color = Model.PATH_COLORS[pathId];
      pathLabel.textContent = `Path ${pathId}`;
      kerbyGrid.appendChild(pathLabel);

      const select = document.createElement("select");
      select.id = `kerby-surface-${pathId}`;
      select.setAttribute("aria-label", `Path ${pathId} Kerby surface`);
      kerbyOptions.forEach(item => select.appendChild(makeOption(item.key, item.label, item.key === Model.DEFAULT_KERBY_SURFACE_KEYS[pathId])));
      kerbyGrid.appendChild(select);
    }

    const prf = byId("peak-rate-factor");
    prf.replaceChildren();
    Model.PEAK_RATE_FACTOR_OPTIONS.forEach(value => {
      const label = value === Model.PEAK_RATE_FACTOR ? `${value} (standard)` : String(value);
      prf.appendChild(makeOption(String(value), label, value === Model.PEAK_RATE_FACTOR));
    });
  }

  function getRadioValue(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    if (!selected) throw new Error(`No value selected for ${name}.`);
    return Number(selected.value);
  }

  function collectSurfaceKeys(prefix) {
    const values = {};
    for (const pathId of [1, 2, 3, 4]) values[pathId] = byId(`${prefix}-${pathId}`).value;
    return values;
  }

  function renderMetric(element, title, value, subtitle) {
    element.innerHTML = `
      <div class="metric-title">${title}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-subtitle">${subtitle}</div>`;
  }

  function renderTable(table, columns, records, options = {}) {
    table.replaceChildren();
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach(column => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = column.label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    records.forEach(record => {
      const row = document.createElement("tr");
      if (record.isControlling) row.classList.add("is-controlling");
      columns.forEach(column => {
        const td = document.createElement("td");
        td.textContent = record[column.key] ?? "";
        if (column.key === "path") {
          td.className = "path-cell";
          const pathId = Number(record.path);
          if (Model.PATH_COLORS[pathId]) td.style.color = Model.PATH_COLORS[pathId];
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    if (options.detail) table.classList.add("detail-table");
  }

  function methodMainTable(results, method) {
    if (method === "tr55") {
      return {
        columns: [
          { key: "path", label: "Path" },
          { key: "sheetType", label: "Sheet Type" },
          { key: "sheetTime", label: "Sheet Time (min)" },
          { key: "shallowType", label: "Shallow Type" },
          { key: "shallowTime", label: "Shallow Time (min)" },
          { key: "channelTime", label: "Channel Time (min)" },
          { key: "totalTime", label: "Total Time (min)" },
          { key: "peakFlow", label: "Peak Flow (cfs)" },
          { key: "peakTime", label: "Peak Time" }
        ],
        records: results.map(item => ({
          path: item.pathId,
          sheetType: item.sheetSurface,
          sheetTime: format2(item.sheetTimeMin),
          shallowType: item.shallowSurface,
          shallowTime: format2(item.shallowTimeMin),
          channelTime: format2(item.channelTimeMin),
          totalTime: format2(item.totalTimeMin),
          peakFlow: format0(item.peakFlowCfs),
          peakTime: formatTimestamp(item.peakTimestampMs),
          isControlling: item.isControlling
        }))
      };
    }
    return {
      columns: [
        { key: "path", label: "Path" },
        { key: "surface", label: "Kerby Surface" },
        { key: "kerbyTime", label: "Kerby Time (min)" },
        { key: "kirpichTime", label: "Kirpich Time (min)" },
        { key: "totalTime", label: "Total Time (min)" },
        { key: "peakFlow", label: "Peak Flow (cfs)" },
        { key: "peakTime", label: "Peak Time" }
      ],
      records: results.map(item => ({
        path: item.pathId,
        surface: item.kerbySurface,
        kerbyTime: format2(item.kerbyTimeMin),
        kirpichTime: format2(item.kirpichTimeMin),
        totalTime: format2(item.totalTimeMin),
        peakFlow: format0(item.peakFlowCfs),
        peakTime: formatTimestamp(item.peakTimestampMs),
        isControlling: item.isControlling
      }))
    };
  }

  function lengthTable(results, method) {
    if (method === "tr55") {
      return {
        columns: [
          { key: "path", label: "Path" },
          { key: "sheetSurface", label: "Sheet Surface" },
          { key: "sheetN", label: "Sheet n" },
          { key: "sheetLength", label: "Sheet Length (ft)" },
          { key: "shallowSurface", label: "Shallow Surface" },
          { key: "shallowK", label: "Shallow K" },
          { key: "shallowVelocity", label: "Shallow Velocity (ft/s)" },
          { key: "shallowLength", label: "Shallow Length (ft)" },
          { key: "channelVelocity", label: "Channel Velocity (ft/s)" },
          { key: "channelLength", label: "Remaining Channel Length (ft)" }
        ],
        records: results.map(item => ({
          path: item.pathId,
          sheetSurface: item.sheetSurface,
          sheetN: Number(item.sheetN).toFixed(3),
          sheetLength: format1(item.sheetLengthFt),
          shallowSurface: item.shallowSurface,
          shallowK: format2(item.shallowK),
          shallowVelocity: format2(item.shallowVelocityFps),
          shallowLength: format1(item.shallowLengthFt),
          channelVelocity: format2(item.channelVelocityFps),
          channelLength: format1(item.remainingChannelLengthFt)
        }))
      };
    }
    return {
      columns: [
        { key: "path", label: "Path" },
        { key: "surface", label: "Kerby Surface" },
        { key: "kerbyN", label: "Kerby N" },
        { key: "kerbyLength", label: "Kerby Length (ft)" },
        { key: "kirpichLength", label: "Kirpich Length (ft)" },
        { key: "overallSlope", label: "Overall Slope" }
      ],
      records: results.map(item => ({
        path: item.pathId,
        surface: item.kerbySurface,
        kerbyN: format2(item.kerbyN),
        kerbyLength: format1(item.kerbyLengthFt),
        kirpichLength: format1(item.kirpichLengthFt),
        overallSlope: Model.overallSlope(Model.FLOW_PATHS[item.pathId]).toFixed(6)
      }))
    };
  }

  function renderMethodStatus(results, method, settings) {
    const controlling = results.find(item => item.isControlling);
    const longestPath = Object.values(Model.FLOW_PATHS).reduce((longest, item) => item.totalLengthFt > longest.totalLengthFt ? item : longest).pathId;
    const setup = method === "tr55"
      ? `Sheet-flow maximum: ${format0(settings.sheetLimitFt)} ft. Shallow-concentrated maximum: ${format0(settings.shallowLimitFt)} ft. Common channel velocity: ${format1(settings.channelVelocityFps)} ft/s.`
      : `Kerby overland-flow maximum: ${format0(settings.kerbyLimitFt)} ft.`;
    const methodName = method === "tr55" ? "TR-55 velocity method" : "Kerby-Kirpich method";
    const interpretation = controlling.pathId === longestPath
      ? `Path ${controlling.pathId}, the longest retained path, is also hydraulically most remote under the current assumptions.`
      : `Path ${controlling.pathId} controls even though retained Path ${longestPath} is longer. Surface and flow-regime travel times outweigh total length.`;
    const warnings = [...new Set(results.flatMap(item => item.warnings || []))];
    byId("status-panel").innerHTML = `
      <h2>Current interpretation: ${methodName}</h2>
      <p>${setup}</p>
      <p class="interpretation">${interpretation}</p>
      ${warnings.map(message => `<div class="warning">${message}</div>`).join("")}
      <p class="build-tag">Static build ${Model.BUILD_VERSION}</p>`;
  }

  function renderTransformStatus(sensitivity) {
    const base = sensitivity.basePath;
    const selected = sensitivity.selected;
    byId("status-panel").innerHTML = `
      <h2>Current interpretation: transform assumptions</h2>
      <p>The flow-path calculation is fixed at Path 1 with 100 ft of sheet flow, 1,000 ft of shallow concentrated flow, and 6 ft/s channel velocity.</p>
      <p class="interpretation">The fixed Tc is ${format1(base.totalTimeMin)} minutes. The selected lag ratio is ${selected.lagRatio.toFixed(2)} and the selected peak rate factor is ${selected.peakRateFactor.toFixed(0)}.</p>
      <p>The green band contains ${sensitivity.solutionCount} solutions covering every available lag-ratio and peak-rate-factor combination.</p>
      <p class="build-tag">Static build ${Model.BUILD_VERSION}</p>`;
  }

  function updateMethod() {
    const method = state.method;
    const settings = {
      sheetLimitFt: getRadioValue("sheet-limit"),
      shallowLimitFt: getRadioValue("shallow-limit"),
      kerbyLimitFt: getRadioValue("kerby-limit"),
      channelVelocityFps: Number(byId("channel-velocity").value),
      p2_24hrIn: state.verifiedP2,
      sheetSurfaceKeys: collectSurfaceKeys("sheet-surface"),
      shallowSurfaceKeys: collectSurfaceKeys("shallow-surface"),
      kerbySurfaceKeys: collectSurfaceKeys("kerby-surface")
    };
    let results = Model.calculateMethodResults({ method, ...settings });
    results = Model.addHydrographMetrics(results);
    const controlling = results.find(item => item.isControlling);
    const highestPeak = results.reduce((highest, item) => item.peakFlowCfs > highest.peakFlowCfs ? item : highest);

    renderMethodStatus(results, method, settings);
    renderMetric(byId("metric-control"), "Controlling Path", `Path ${controlling.pathId}`, `${method === "tr55" ? "TR-55" : "Kerby-Kirpich"} rank 1`);
    renderMetric(byId("metric-tc"), "Controlling Tc", `${format1(controlling.totalTimeMin)} min`, `${format2(controlling.totalTimeMin / 60)} hr`);
    renderMetric(byId("metric-peak"), "Highest Modeled Peak", `${format0(highestPeak.peakFlowCfs)} cfs`, `Path ${highestPeak.pathId} at ${formatTimestamp(highestPeak.peakTimestampMs)}`);

    const main = methodMainTable(results, method);
    renderTable(byId("main-table"), main.columns, main.records);
    const detail = lengthTable(results, method);
    renderTable(byId("length-table"), detail.columns, detail.records, { detail: true });
    Charts.render(byId("hydrograph-plot"), Charts.buildMethodFigure(results));
  }

  function updateTransform() {
    const lagRatio = Number(byId("lag-ratio").value);
    const peakRateFactor = Number(byId("peak-rate-factor").value);
    const sensitivity = Model.calculateTransformSensitivity(lagRatio, peakRateFactor);
    const base = sensitivity.basePath;
    const selected = sensitivity.selected;

    renderTransformStatus(sensitivity);
    renderMetric(byId("metric-control"), "Fixed Flow Path", "Path 1", "100-ft sheet / 1,000-ft shallow / 6 ft/s channel");
    renderMetric(byId("metric-tc"), "Fixed Tc", `${format1(base.totalTimeMin)} min`, `${format2(base.totalTimeMin / 60)} hr`);
    renderMetric(
      byId("metric-peak"),
      "Selected Peak",
      `${format0(selected.peakFlowCfs)} cfs`,
      `${formatTimestamp(selected.peakTimestampMs)}; solution-set peaks ${format0(sensitivity.minimumPeakCfs)}-${format0(sensitivity.maximumPeakCfs)} cfs`
    );

    renderTable(byId("main-table"), [
      { key: "path", label: "Path" },
      { key: "fixedTc", label: "Fixed Tc (min)" },
      { key: "lagRatio", label: "Lag Ratio" },
      { key: "lagTime", label: "Lag Time (hr)" },
      { key: "prf", label: "Peak Rate Factor" },
      { key: "peakFlow", label: "Peak Flow (cfs)" },
      { key: "peakTime", label: "Peak Time" }
    ], [{
      path: 1,
      fixedTc: format2(base.totalTimeMin),
      lagRatio: selected.lagRatio.toFixed(2),
      lagTime: format3(selected.lagHr),
      prf: selected.peakRateFactor.toFixed(0),
      peakFlow: format0(selected.peakFlowCfs),
      peakTime: formatTimestamp(selected.peakTimestampMs),
      isControlling: true
    }]);

    const detail = lengthTable([base], "tr55");
    renderTable(byId("length-table"), detail.columns, detail.records, { detail: true });
    Charts.render(byId("hydrograph-plot"), Charts.buildTransformFigure(sensitivity));
  }

  function renderError(error) {
    byId("status-panel").innerHTML = `
      <h2 class="error-title">Calculation error</h2>
      <p>${String(error.message || error)}</p>
      <p class="build-tag">Static build ${Model.BUILD_VERSION}</p>
      <details class="error-details"><summary>Technical details</summary><pre>${String(error.stack || error)}</pre></details>`;
    ["metric-control", "metric-tc", "metric-peak"].forEach(id => renderMetric(byId(id), "Result", "--", "Check the current inputs"));
    renderTable(byId("main-table"), [], []);
    renderTable(byId("length-table"), [], []);
    Charts.renderError(byId("hydrograph-plot"), error.message || error);
  }

  function update() {
    document.body.classList.add("is-loading");
    try {
      if (state.method === "transform") updateTransform();
      else updateMethod();
    } catch (error) {
      console.error(error);
      renderError(error);
    } finally {
      document.body.classList.remove("is-loading");
    }
  }

  function requestUpdate() {
    if (state.updateTimer !== null) clearTimeout(state.updateTimer);
    state.updateTimer = setTimeout(() => {
      state.updateTimer = null;
      update();
    }, 0);
  }

  function switchMethod(method) {
    state.method = method;
    document.querySelectorAll(".method-tab").forEach(button => {
      const active = button.dataset.method === method;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    byId("tr55-controls").classList.toggle("is-hidden", method !== "tr55");
    byId("kerby-controls").classList.toggle("is-hidden", method !== "kerby");
    byId("transform-controls").classList.toggle("is-hidden", method !== "transform");
    if (method === "transform") {
      byId("status-panel").innerHTML = "<h2>Computing solution envelope</h2><p>Evaluating all 252 lag-ratio and peak-rate-factor combinations.</p>";
    }
    requestUpdate();
  }

  function bindEvents() {
    document.querySelectorAll(".method-tab").forEach(button => button.addEventListener("click", () => switchMethod(button.dataset.method)));
    document.querySelectorAll("input[type=radio], select").forEach(element => element.addEventListener("change", requestUpdate));

    byId("channel-velocity").addEventListener("input", event => {
      byId("channel-velocity-value").value = Number(event.target.value).toFixed(1);
      requestUpdate();
    });
    byId("lag-ratio").addEventListener("input", event => {
      byId("lag-ratio-value").value = Number(event.target.value).toFixed(2);
      requestUpdate();
    });

    globalScope.addEventListener("resize", () => {
      if (globalScope.Plotly) globalScope.Plotly.Plots.resize(byId("hydrograph-plot"));
    });
  }

  function checkpointP2Source(carriedDepth) {
    const upload = state.checkpointP2Upload;
    if (!upload) return { depthIn: carriedDepth, label: "the value carried from the Precipitation module" };
    if (upload.status === "reading") return { error: "Wait for the selected CSV to finish loading." };
    if (upload.status === "error") return { error: `The uploaded CSV could not be used: ${upload.message}` };
    return { depthIn: upload.depthIn, label: `the uploaded CSV (${upload.filename})` };
  }

  async function readCheckpointAtlasFile(file, status) {
    if (!file) {
      state.checkpointP2Upload = null;
      status.textContent = "No CSV selected. The answer will be checked against the value carried from the Precipitation module.";
      return;
    }
    state.checkpointP2Upload = { status: "reading", filename: file.name };
    status.textContent = `Reading ${file.name}...`;
    try {
      const depthIn = Model.parseAtlasP2Depth(await file.text());
      state.checkpointP2Upload = { status: "ready", filename: file.name, depthIn };
      status.textContent = `Selected: ${file.name}. The answer will be checked against this CSV.`;
    } catch (error) {
      state.checkpointP2Upload = { status: "error", filename: file.name, message: error.message };
      status.textContent = `Could not use ${file.name}: ${error.message}`;
    }
  }

  function initializeCheckpoints() {
    const correctP2 = carriedP2Depth();
    const pavement = SURFACE_QC_RESULTS.pavement;
    const grass = SURFACE_QC_RESULTS.grass;
    const checkpoints = [
      {
        id: "stale-p2",
        title: "QC the inherited rainfall depth",
        task: `The supplied Tc worksheet uses ${Model.P2_24HR_IN.toFixed(2)} inches for the 2-year, 24-hour depth. Enter the verified value. Optionally upload the Atlas 14 CSV again; if provided, your answer will be checked against the CSV. Otherwise, it will be checked against the value carried from the Precipitation module.`,
        render: body => {
          body.className = "checkpoint-body qc-answer";
          body.innerHTML = `
            <label for="qc-p2-depth"><strong>Verified 2-year, 24-hour depth (in)</strong></label>
            <input id="qc-p2-depth" type="number" step="0.01" inputmode="decimal">
            <label class="qc-file-label" for="qc-atlas-file"><strong>Optional Atlas 14 CSV</strong></label>
            <input id="qc-atlas-file" type="file" accept=".csv,text/csv">
            <p id="qc-atlas-status" class="qc-file-status">No CSV selected. The answer will be checked against the value carried from the Precipitation module.</p>`;
          const fileInput = byId("qc-atlas-file");
          const fileStatus = byId("qc-atlas-status");
          fileInput.addEventListener("change", () => readCheckpointAtlasFile(fileInput.files && fileInput.files[0], fileStatus));
        },
        evaluate: () => {
          const source = checkpointP2Source(correctP2);
          if (source.error) return { status: Checkpoints.RESULT.INVALID, message: source.error };
          const evaluation = Checkpoints.evaluateNumeric(byId("qc-p2-depth").value, source.depthIn, { absolute: 0.03, percent: 2, closeMultiplier: 3 });
          if (evaluation.status === Checkpoints.RESULT.ACCEPTABLE) {
            state.verifiedP2 = source.depthIn;
            update();
            return { status: evaluation.status, storedResult: { depthIn: source.depthIn }, message: `Correct. The inherited rainfall depth has been replaced with the location-specific value from ${source.label}. Never assume a spreadsheet default is current.` };
          }
          if (evaluation.status === Checkpoints.RESULT.CLOSE) return { status: evaluation.status, message: "Close. Use the value you verified for the same location, series, duration, and units." };
          return { status: evaluation.status, message: `That does not match the 2-year, 24-hour depth from ${source.label}.` };
        },
        takeaway: "Inherited spreadsheet values are inputs to be verified, not facts."
      },
      {
        id: "flow-path-qc",
        title: "Review the physical flow path",
        task: "Would you accept this mapped Tc flow path? If not, what is the controlling QC issue?",
        render: body => {
          body.className = "checkpoint-body qc-answer";
          body.innerHTML = `
            <figure class="qc-map-figure"><img class="qc-map-image" src="assets/checkpoint-flow-path-qc.webp" alt="Terrain map with an outlined subcatchment and a mapped flow path crossing directly through a building footprint"></figure>
            <div class="qc-choice-row">
              <label><input type="radio" name="flow-accept" value="accept"> Accept</label>
              <label><input type="radio" name="flow-accept" value="reject"> Reject</label>
            </div>
            <div id="flow-reason-group" hidden>
              <label for="flow-reason"><strong>Controlling QC issue</strong></label>
              <select id="flow-reason">
                <option value="">Select an issue</option>
                <option value="longest">It is not the geometrically longest possible line</option>
                <option value="building">The assumed runoff route passes through a building and is not physically continuous</option>
                <option value="color">The mapped line color is difficult to see</option>
              </select>
            </div>`;
          const reasonGroup = byId("flow-reason-group");
          const reason = byId("flow-reason");
          document.querySelectorAll('input[name="flow-accept"]').forEach(input => input.addEventListener("change", () => {
            const rejecting = input.value === "reject" && input.checked;
            reasonGroup.hidden = !rejecting;
            if (!rejecting) reason.value = "";
          }));
        },
        evaluate: () => {
          const choice = document.querySelector('input[name="flow-accept"]:checked');
          const reason = byId("flow-reason").value;
          if (choice && choice.value === "reject" && reason === "building") {
            return { status: Checkpoints.RESULT.ACCEPTABLE, message: "Correct. A Tc path represents actual travel from the temporally most remote contributing point. Water cannot follow the assumed surface route through a building, so the analysis is physically inconsistent." };
          }
          if (!choice) return { status: Checkpoints.RESULT.INVALID, message: "Choose whether to accept or reject the mapped flow path." };
          if (choice.value === "accept") return { status: Checkpoints.RESULT.INCORRECT, message: "Reconsider whether a drop of water could physically travel along every segment of the mapped line." };
          if (!reason) return { status: Checkpoints.RESULT.INVALID, message: "Select the controlling QC issue for rejecting the mapped flow path." };
          return { status: Checkpoints.RESULT.INCORRECT, message: "Rejecting it is appropriate, but focus on physical continuity—not whether it is the longest line or how it is drawn." };
        },
        takeaway: "The controlling path is the hydraulically most remote defensible route, not merely the longest line on a map."
      },
      {
        id: "surface-qc",
        title: "Classify the sheet-flow surface",
        task: "The short mapped sheet-flow path lies on the grass side of the visible pavement boundary. Select the defensible surface and review the local subcatchment consequence.",
        render: body => {
          body.className = "checkpoint-body qc-answer";
          body.innerHTML = `
            <figure class="qc-map-figure"><img class="qc-map-image" src="assets/checkpoint-surface-qc.webp" alt="Terrain map with an outlined subcatchment and a short sheet-flow path entirely on grass beside a pavement boundary"></figure>
            <label for="surface-choice"><strong>Defensible classification</strong></label>
            <select id="surface-choice"><option value="">Select surface</option><option value="smooth">Pavement / smooth surface</option><option value="short_grass">Short grass</option></select>
            <table class="surface-comparison"><thead><tr><th>Assumption</th><th>Local Tc</th><th>Modeled peak</th></tr></thead><tbody>
              <tr><td>Pavement / smooth</td><td>${format1(pavement.tcMin)} min</td><td>${format0(pavement.peakCfs)} cfs</td></tr>
              <tr><td>Short grass</td><td>${format1(grass.tcMin)} min</td><td>${format0(grass.peakCfs)} cfs</td></tr>
            </tbody></table>`;
        },
        evaluate: () => {
          const choice = byId("surface-choice").value;
          if (choice === "short_grass") {
            return { status: Checkpoints.RESULT.ACCEPTABLE, message: `Correct. The imagery supports grass. For this local subcatchment, the rougher surface increases Tc from ${format1(pavement.tcMin)} to ${format1(grass.tcMin)} minutes and reduces the modeled peak from ${format0(pavement.peakCfs)} to ${format0(grass.peakCfs)} cfs.` };
          }
          if (!choice) return { status: Checkpoints.RESULT.INVALID, message: "Select the surface supported by the mapped start point." };
          return { status: Checkpoints.RESULT.INCORRECT, message: "The arrow begins to the right of the boundary, within the grass. Classify the surface actually traversed, even when a nearby pavement interpretation is tempting." };
        },
        takeaway: "Small spatial choices matter when they change the physical flow regime or roughness assumption."
      }
    ];

    state.checkpointFlow = new Checkpoints.CheckpointFlow({
      moduleId: "transform",
      checkpoints,
      elements: {
        number: byId("checkpoint-number"), title: byId("checkpoint-title"), task: byId("checkpoint-task"),
        body: byId("checkpoint-body"), feedback: byId("checkpoint-feedback"), checkButton: byId("checkpoint-check"),
        nextButton: byId("checkpoint-next"), resetButton: byId("checkpoint-reset"), progress: byId("checkpoint-progress"),
        completeMessage: byId("checkpoint-complete")
      },
      onUnlock: (unlocked, snapshot) => {
        ["sandbox-tabs", "sandbox-main", "sandbox-map", "sandbox-notes"].forEach(id => byId(id).classList.toggle("is-checkpoint-locked", !unlocked));
        byId("sandbox-lock").hidden = unlocked;
        const verified = snapshot.results["stale-p2"] && Number(snapshot.results["stale-p2"].depthIn);
        if (Number.isFinite(verified) && verified > 0) state.verifiedP2 = verified;
        if (unlocked) {
          update();
        }
      },
      onReset: () => {
        state.verifiedP2 = Model.P2_24HR_IN;
        state.checkpointP2Upload = null;
        update();
      }
    });
  }

  function initialize() {
    buildSurfaceGrids();
    byId("total-excess").textContent = Model.TOTAL_EXCESS_IN.toFixed(3);
    bindEvents();
    update();
    initializeCheckpoints();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})(typeof globalThis !== "undefined" ? globalThis : window);
