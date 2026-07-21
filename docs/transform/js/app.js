/* DOM wiring for the Transform Flow Path Explorer. */
(function (globalScope) {
  "use strict";

  const Model = globalScope.TransformModel;
  const Charts = globalScope.TransformCharts;
  if (!Model || !Charts) throw new Error("model.js and charts.js must load before app.js.");

  const state = { method: "tr55", updateTimer: null };

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

  function initialize() {
    buildSurfaceGrids();
    byId("total-excess").textContent = Model.TOTAL_EXCESS_IN.toFixed(3);
    bindEvents();
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})(typeof globalThis !== "undefined" ? globalThis : window);
