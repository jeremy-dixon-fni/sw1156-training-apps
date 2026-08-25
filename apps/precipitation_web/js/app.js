(function (global) {
  "use strict";

  const Model = global.PrecipModel;
  const Charts = global.PrecipCharts;
  const Checkpoints = global.TrainingCheckpoints;

  const state = {
    atlasText: Model.SAMPLE_ATLAS14_CSV,
    atlasFilename: null,
    usingSample: true,
    distributionLibrary: {},
    libraryWarnings: [],
    checkpointFlow: null,
    checkpointDepths: {}
  };

  const LOOKUP_CHALLENGES = Object.freeze([
    { ariYr: 25, durationMin: 180, quantity: "intensity" },
    { ariYr: 10, durationMin: 30, quantity: "depth" },
    { ariYr: 50, durationMin: 120, quantity: "intensity" }
  ]);

  function assignedExercise() {
    const key = "training-checkpoints:precipitation:assignment:v1";
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved && saved.lookup) return saved;
    } catch (_error) { /* use a fresh assignment */ }
    const assignment = {
      requestedQuantity: Math.random() < 0.5 ? "depth" : "intensity",
      requestedSeries: Math.random() < 0.5 ? "partial-duration" : "annual-maximum",
      lookup: LOOKUP_CHALLENGES[Math.floor(Math.random() * LOOKUP_CHALLENGES.length)]
    };
    sessionStorage.setItem(key, JSON.stringify(assignment));
    return assignment;
  }

  const assignment = assignedExercise();

  const tableColumns = Object.freeze([
    ["duration", null],
    ["enteredAtlasDepthIn", 3],
    ["atlas100DepthIn", 3],
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
      tableColumns.forEach(([key, digits]) => {
        const td = document.createElement("td");
        td.textContent = formatTableValue(row[key], digits);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
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

  function uploadedAtlas() {
    return state.usingSample ? null : Model.parseAtlas14CsvText(state.atlasText);
  }

  function numericAnswer(body, id, label, unit) {
    body.className = "checkpoint-body";
    body.replaceChildren();
    const labelNode = document.createElement("label");
    labelNode.className = "control-label";
    labelNode.htmlFor = id;
    labelNode.textContent = `${label} (${unit})`;
    const input = document.createElement("input");
    input.id = id;
    input.className = "number-input";
    input.type = "number";
    input.step = "0.01";
    input.inputMode = "decimal";
    body.append(labelNode, input);
  }

  function requireAtlas() {
    try {
      const atlas = uploadedAtlas();
      return atlas ? { atlas } : { error: "Upload the Atlas 14 table you retrieved before submitting an answer." };
    } catch (error) {
      return { error: `The uploaded CSV could not be recognized as an Atlas 14 frequency table: ${error.message}` };
    }
  }

  function compareAnswer(actual, target, unit, storedResult) {
    const result = Checkpoints.evaluateNumeric(actual, target, { absolute: 0.03, percent: 2, closeMultiplier: 3 });
    if (result.status === Checkpoints.RESULT.INVALID) {
      return { status: result.status, message: `Enter a numeric answer in ${unit}.` };
    }
    if (result.status === Checkpoints.RESULT.CLOSE) {
      return { status: result.status, message: "Close. Recheck the duration, recurrence interval, and whether the requested unit requires a depth/intensity conversion." };
    }
    if (result.status !== Checkpoints.RESULT.ACCEPTABLE) {
      return { status: result.status, message: `That result is materially ${result.difference > 0 ? "high" : "low"}. Confirm the table row, column, and requested unit.` };
    }
    return { status: result.status, storedResult };
  }

  function makeCheckpoints() {
    const lookup = assignment.lookup;
    const lookupUnit = lookup.quantity === "depth" ? "in" : "in/hr";
    const checkpoints = [
      {
        id: "random-lookup",
        title: "Read an Atlas 14 frequency table",
        task: `What is the ${lookup.ariYr}-year, ${Model.formatDuration(lookup.durationMin)} precipitation ${lookup.quantity}? Report ${lookupUnit}.`,
        render: body => numericAnswer(body, "checkpoint-answer", "Your lookup", lookupUnit),
        evaluate: () => {
          const source = requireAtlas();
          if (source.error) return { status: Checkpoints.RESULT.INCORRECT, message: source.error };
          const depth = Model.getDepth(source.atlas, lookup.ariYr, lookup.durationMin);
          const target = lookup.quantity === "depth" ? depth : Model.intensityFromDepth(depth, lookup.durationMin);
          const result = compareAnswer(element("checkpoint-answer").value, target, lookupUnit, { target, quantity: lookup.quantity });
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) {
            result.message = "Correct. You selected the proper duration and recurrence interval and interpreted the requested quantity.";
          }
          return result;
        },
        takeaway: "A valid lookup depends on duration, recurrence interval, quantity, and units—not just finding a nearby number."
      },
      {
        id: "two-year-24-hour",
        title: "Verify the 2-year, 24-hour depth",
        task: "Enter the 2-year, 24-hour precipitation depth in inches.",
        render: body => numericAnswer(body, "checkpoint-answer", "2-year, 24-hour depth", "in"),
        evaluate: () => {
          const source = requireAtlas();
          if (source.error) return { status: Checkpoints.RESULT.INCORRECT, message: source.error };
          const target = Model.getDepth(source.atlas, 2, 1440);
          const result = compareAnswer(element("checkpoint-answer").value, target, "in", { depthIn: target });
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) {
            sessionStorage.setItem("training-transfer:atlas14:2yr24hr-depth-in", String(target));
            result.message = "Correct. This 2-year, 24-hour depth is commonly used again in time-of-concentration calculations, so it has been carried forward for the Transform lesson.";
          }
          return result;
        },
        takeaway: "This value often feeds sheet-flow travel-time calculations; inherited values should be checked against current location data."
      },
      {
        id: "hundred-year-24-hour",
        title: "Identify the design-storm depth",
        task: "Enter the 100-year, 24-hour precipitation depth in inches.",
        render: body => numericAnswer(body, "checkpoint-answer", "100-year, 24-hour depth", "in"),
        evaluate: () => {
          const source = requireAtlas();
          if (source.error) return { status: Checkpoints.RESULT.INCORRECT, message: source.error };
          const target = Model.getDepth(source.atlas, 100, 1440);
          const result = compareAnswer(element("checkpoint-answer").value, target, "in", { depthIn: target });
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) {
            state.checkpointDepths[1440] = target;
            result.message = "Correct. This total depth defines the 100-year, 24-hour design criterion, but it does not define how rainfall is arranged through time.";
          }
          return result;
        },
        takeaway: "Total design depth and temporal distribution are separate assumptions."
      },
      {
        id: "balanced-frequency",
        title: "Supply depths for an alternating-block storm",
        task: "Enter the 100-year depths at 1, 6, 12, and 24 hours. These depth-duration values are used to rank the incremental blocks.",
        render: body => {
          body.replaceChildren();
          body.className = "checkpoint-body checkpoint-answer-grid";
          [[60, "1-hour"], [360, "6-hour"], [720, "12-hour"], [1440, "24-hour"]].forEach(([duration, label]) => {
            const wrapper = document.createElement("div");
            const labelNode = document.createElement("label");
            labelNode.className = "control-label";
            labelNode.htmlFor = `checkpoint-depth-${duration}`;
            labelNode.textContent = `${label} depth (in)`;
            const input = document.createElement("input");
            input.id = `checkpoint-depth-${duration}`;
            input.className = "number-input";
            input.type = "number";
            input.step = "0.01";
            wrapper.append(labelNode, input);
            body.appendChild(wrapper);
          });
        },
        evaluate: () => {
          const source = requireAtlas();
          if (source.error) return { status: Checkpoints.RESULT.INCORRECT, message: source.error };
          const durations = [60, 360, 720, 1440];
          const checks = durations.map(duration => ({
            duration,
            evaluation: Checkpoints.evaluateNumeric(element(`checkpoint-depth-${duration}`).value, Model.getDepth(source.atlas, 100, duration), { absolute: 0.03, percent: 2, closeMultiplier: 3 })
          }));
          if (checks.some(item => item.evaluation.status === Checkpoints.RESULT.INVALID)) {
            return { status: Checkpoints.RESULT.INVALID, message: "Enter all four depths before checking the storm inputs." };
          }
          if (checks.every(item => item.evaluation.status === Checkpoints.RESULT.ACCEPTABLE)) {
            durations.forEach(duration => {
              state.checkpointDepths[duration] = Model.getDepth(source.atlas, 100, duration);
            });
            element("method-dropdown").value = "abm_50";
            updateOutputs();
            return { status: Checkpoints.RESULT.ACCEPTABLE, message: "Correct. The depth-duration curve has been translated into incremental blocks and rearranged around the storm center. The comparison sandbox is now unlocked." };
          }
          const closeOnly = checks.every(item => [Checkpoints.RESULT.ACCEPTABLE, Checkpoints.RESULT.CLOSE].includes(item.evaluation.status));
          return { status: closeOnly ? Checkpoints.RESULT.CLOSE : Checkpoints.RESULT.INCORRECT, message: closeOnly ? "The set is close. Recheck rounding and make sure every entry comes from the 100-year column." : "One or more depths use the wrong duration or recurrence-interval column. Recheck the four rows." };
        },
        takeaway: "Alternating-block storms preserve the selected depth-duration relationship while assigning the largest incremental depths near a chosen center."
      }
    ];
    return checkpoints;
  }

  function initializeCheckpoints() {
    element("atlas-assignment-text").textContent = `Retrieve a ${assignment.requestedSeries} ${assignment.requestedQuantity} table from Atlas 14. The checkpoints also accept the counterpart format and test the necessary conversions.`;
    state.checkpointFlow = new Checkpoints.CheckpointFlow({
      moduleId: "precipitation",
      checkpoints: makeCheckpoints(),
      elements: {
        number: element("checkpoint-number"), title: element("checkpoint-title"), task: element("checkpoint-task"),
        body: element("checkpoint-body"), feedback: element("checkpoint-feedback"), checkButton: element("checkpoint-check"),
        nextButton: element("checkpoint-next"), resetButton: element("checkpoint-reset"), progress: element("checkpoint-progress"),
        completeMessage: element("checkpoint-complete")
      },
      onUnlock: unlocked => {
        element("sandbox-content").classList.toggle("is-checkpoint-locked", !unlocked);
        element("sandbox-lock").hidden = unlocked;
      },
      onReset: () => {
        state.atlasText = Model.SAMPLE_ATLAS14_CSV;
        state.atlasFilename = null;
        state.usingSample = true;
        state.checkpointDepths = {};
        element("atlas-file").value = "";
        element("atlas-file-name").textContent = "Upload your Atlas 14 export to begin. The built-in sample remains available only for the unlocked sandbox.";
        updateOutputs();
      }
    });
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

      const checkpointDepths = state.checkpointDepths;
      const applied24Hour = atlas24HourDepth;
      if (!(applied24Hour > 0)) {
        throw new Error("The applied 24-hour rainfall depth must be positive.");
      }

      const method = element("method-dropdown").value;
      if (!method) {
        throw new Error("No temporal distribution is available.");
      }

      const storm = Model.generateStorm(atlas, method, applied24Hour, state.distributionLibrary);
      const generatedIdf = Model.computeGeneratedIdf(storm, atlas);
      const verificationRows = Model.makeDepthCheckTable(atlas, generatedIdf, checkpointDepths);
      const sourceText = state.usingSample
        ? "built-in sample Atlas 14 CSV"
        : `uploaded file: ${state.atlasFilename || "Atlas 14 CSV"}`;

      setStatus(
        "Atlas 14 data loaded",
        [
          `Source: ${sourceText}.`,
          Model.metadataLocationText(atlas),
          `Temporal distribution: ${storm.method}.`,
          "The distribution is scaled to the Atlas 14 100-year, 24-hour depth. Atlas durations longer than 2 days are excluded."
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

    element("method-dropdown").addEventListener("change", updateOutputs);

    const libraryResult = await Model.loadDistributionLibrary(
      "data/temporal_distributions/manifest.json",
      "data/temporal_distributions"
    );
    state.distributionLibrary = libraryResult.library;
    state.libraryWarnings = libraryResult.warnings;
    populateMethodDropdown();
    updateOutputs();
    initializeCheckpoints();

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
