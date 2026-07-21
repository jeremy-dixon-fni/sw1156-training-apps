(function (global) {
  "use strict";

  const Model = global.PrecipModel;
  const Charts = global.PrecipCharts;

  const state = {
    atlasText: Model.SAMPLE_ATLAS14_CSV,
    atlasFilename: null,
    usingSample: true,
    distributionLibrary: {},
    libraryWarnings: []
  };

  const manualInputIds = Object.freeze({
    5: "manual-5min-depth",
    15: "manual-15min-depth",
    60: "manual-1hr-depth",
    120: "manual-2hr-depth",
    180: "manual-3hr-depth",
    360: "manual-6hr-depth",
    720: "manual-12hr-depth",
    1440: "manual-24hr-depth"
  });

  const tableColumns = Object.freeze([
    ["duration", null],
    ["enteredAtlasDepthIn", 3],
    ["atlas100DepthIn", 3],
    ["manualDifferenceIn", 3],
    ["manualCheck", null],
    ["processedStormMaxDepthIn", 3],
    ["processedMinusAtlasDepthIn", 3],
    ["processedStormIntensityInHr", 3],
    ["atlas100IntensityInHr", 3],
    ["processedMinusAtlasIntensityInHr", 3]
  ]);

  function element(id) {
    const node = document.getElementById(id);
    if (!node) {
      throw new Error(`Required page element '${id}' was not found.`);
    }
    return node;
  }

  function debounce(callback, delayMs) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => callback.apply(null, args), delayMs);
    };
  }

  function setStatus(title, paragraphs, options) {
    const settings = options || {};
    const container = element("status-message");
    container.replaceChildren();
    container.classList.toggle("is-error", Boolean(settings.error));

    const heading = document.createElement("h2");
    heading.textContent = title;
    container.appendChild(heading);

    (paragraphs || []).forEach((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      container.appendChild(paragraph);
    });

    (settings.warnings || []).forEach((text) => {
      const warning = document.createElement("p");
      warning.className = "status-warning";
      warning.textContent = text;
      container.appendChild(warning);
    });
  }

  function setMetric(id, title, value, subtitle) {
    const container = element(id);
    container.querySelector(".metric-title").textContent = title;
    container.querySelector(".metric-value").textContent = value;
    container.querySelector(".metric-subtitle").textContent = subtitle;
  }

  function clearMetrics(subtitle) {
    const message = subtitle || "Check inputs";
    setMetric("metric-location", "Location", "--", message);
    setMetric("metric-total", "Applied 24-hr Depth", "--", message);
    setMetric("metric-peak", "Peak 5-min Intensity", "--", message);
    setMetric("metric-1hr", "Processed 1-hr Max", "--", message);
  }

  function formatTableValue(value, digits) {
    if (value === null || value === undefined || value === "") {
      return "--";
    }
    if (digits === null) {
      return String(value);
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : "--";
  }

  function renderVerificationTable(rows) {
    const body = element("verification-table-body");
    body.replaceChildren();

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.manualCheck === "Pass") {
        tr.className = "check-pass";
      } else if (row.manualCheck === "Check") {
        tr.className = "check-attention";
      } else if (row.manualCheck === "Missing") {
        tr.className = "check-missing";
      }

      tableColumns.forEach(([key, digits]) => {
        const td = document.createElement("td");
        td.textContent = formatTableValue(row[key], digits);
        if (key === "manualCheck") {
          td.className = "manual-status";
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function manualDepthValues() {
    const values = {};
    Object.entries(manualInputIds).forEach(([durationMin, id]) => {
      values[Number(durationMin)] = element(id).value;
    });
    return values;
  }

  function populateMethodDropdown() {
    const dropdown = element("method-dropdown");
    const previous = dropdown.value;
    const options = Model.distributionDropdownOptions(state.distributionLibrary);
    dropdown.replaceChildren();

    options.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      dropdown.appendChild(node);
    });

    if (options.some((option) => option.value === previous)) {
      dropdown.value = previous;
      return;
    }

    const preferred = options.find((option) => option.value === "dist::scs_type_ii") || options[0];
    if (preferred) {
      dropdown.value = preferred.value;
    }
  }

  async function readAtlasFile(file) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      state.atlasText = text;
      state.atlasFilename = file.name;
      state.usingSample = false;
      element("atlas-file-name").textContent = `Selected: ${file.name}`;
      updateOutputs();
    } catch (error) {
      setStatus("File error", [`Could not read ${file.name}: ${error.message}`], { error: true });
    }
  }

  function bindUploadControl() {
    const zone = element("atlas-upload-zone");
    const input = element("atlas-file");

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => readAtlasFile(input.files && input.files[0]));

    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragging");
      });
    });
    zone.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      readAtlasFile(file);
    });
  }

  function updateOutputs() {
    try {
      const atlas = Model.parseAtlas14CsvText(state.atlasText);
      const atlas24HourDepth = Model.getDepth(
        atlas,
        Model.CONSTANTS.REFERENCE_ARI_YR,
        Model.CONSTANTS.STORM_DURATION_MIN
      );

      const manualDepths = manualDepthValues();
      const entered24Hour = Model.safeNumber(manualDepths[Model.CONSTANTS.STORM_DURATION_MIN], null);
      const applied24Hour = entered24Hour === null ? atlas24HourDepth : entered24Hour;
      if (!(applied24Hour > 0)) {
        throw new Error("The applied 24-hour rainfall depth must be positive.");
      }

      const method = element("method-dropdown").value;
      if (!method) {
        throw new Error("No temporal distribution is available.");
      }

      const storm = Model.generateStorm(atlas, method, applied24Hour, state.distributionLibrary);
      const generatedIdf = Model.computeGeneratedIdf(storm, atlas);
      const verificationRows = Model.makeDepthCheckTable(atlas, generatedIdf, manualDepths);

      const passCount = verificationRows.filter((row) => row.manualCheck === "Pass").length;
      const checkCount = verificationRows.filter((row) => row.manualCheck === "Check").length;
      const missingCount = verificationRows.filter((row) => row.manualCheck === "Missing").length;
      const sourceText = state.usingSample
        ? "built-in sample Atlas 14 CSV"
        : `uploaded file: ${state.atlasFilename || "Atlas 14 CSV"}`;

      setStatus(
        "Atlas 14 data loaded",
        [
          `Source: ${sourceText}.`,
          Model.metadataLocationText(atlas),
          `Temporal distribution: ${storm.method}.`,
          `Manual depth checks: ${passCount} pass, ${checkCount} check, ${missingCount} missing. ` +
            "The distribution is scaled to the entered 24-hour depth when present. Atlas durations longer than 2 days are excluded."
        ],
        { warnings: state.libraryWarnings }
      );

      const location = atlas.metadata["Location name (ESRI Maps)"] || "Unknown";
      const fiveMinute = generatedIdf.find((row) => Math.abs(row.durationMin - 5) <= 1e-9);
      const oneHour = generatedIdf.find((row) => Math.abs(row.durationMin - 60) <= 1e-9);
      if (!fiveMinute || !oneHour) {
        throw new Error("The processed storm diagnostics do not contain the required 5-minute and 1-hour durations.");
      }
      const peakIndex = Model.argMax(storm.incrementalDepthIn);
      const peakTimeHours = storm.timeMidMin[peakIndex] / 60;

      setMetric("metric-location", "Location", location, "from Atlas 14 CSV metadata");
      setMetric(
        "metric-total",
        "Applied 24-hr Depth",
        `${applied24Hour.toFixed(2)} in`,
        `Atlas reference ${atlas24HourDepth.toFixed(2)} in`
      );
      setMetric(
        "metric-peak",
        "Peak 5-min Intensity",
        `${fiveMinute.generatedIntensityInHr.toFixed(2)} in/hr`,
        `peak block at ${peakTimeHours.toFixed(2)} hr`
      );
      setMetric(
        "metric-1hr",
        "Processed 1-hr Max",
        `${oneHour.generatedMaxDepthIn.toFixed(2)} in`,
        `Atlas reference ${Model.getDepth(atlas, Model.CONSTANTS.REFERENCE_ARI_YR, 60).toFixed(2)} in`
      );

      Charts.renderIdf("idf-plot", atlas, generatedIdf);
      Charts.renderHyetograph("hyetograph-plot", storm);
      renderVerificationTable(verificationRows);
    } catch (error) {
      setStatus("Evaluation error", [error.message], { error: true, warnings: state.libraryWarnings });
      clearMetrics("Check Atlas 14 CSV and manual inputs");
      Charts.renderEmpty("idf-plot", "Atlas 14 IDF Curve Comparisons", 650);
      Charts.renderEmpty("hyetograph-plot", "Generated Hyetograph", 500);
      renderVerificationTable([]);
    }
  }

  async function initialize() {
    bindUploadControl();

    const updateDebounced = debounce(updateOutputs, 120);
    Object.values(manualInputIds).forEach((id) => {
      element(id).addEventListener("input", updateDebounced);
    });
    element("method-dropdown").addEventListener("change", updateOutputs);

    const libraryResult = await Model.loadDistributionLibrary(
      "data/temporal_distributions/manifest.json",
      "data/temporal_distributions"
    );
    state.distributionLibrary = libraryResult.library;
    state.libraryWarnings = libraryResult.warnings;
    populateMethodDropdown();
    updateOutputs();

    window.addEventListener("resize", debounce(() => {
      Charts.resize("idf-plot");
      Charts.resize("hyetograph-plot");
    }, 150));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize().catch((error) => {
      setStatus("Initialization error", [error.message], { error: true });
      clearMetrics("Initialization failed");
    });
  });
})(window);
