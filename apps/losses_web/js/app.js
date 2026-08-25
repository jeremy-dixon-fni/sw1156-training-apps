(function () {
  "use strict";

  const Model = window.LossesModel;
  const Charts = window.LossesCharts;
  const Checkpoints = window.TrainingCheckpoints;

  if (!Model || !Charts) {
    throw new Error("The model and chart scripts must load before app.js.");
  }

  const elements = {};
  let updateQueued = false;
  let checkpointFlow = null;

  const BASELINE = Object.freeze({ initial: 1.0, constant: 0.20, impervious: 30 });

  function resultFor(initial, constant, impervious) {
    const result = Model.computeInitialConstantLosses(initial, constant, impervious);
    return { result, summary: Model.summarizeResult(result) };
  }

  const TARGETS = Object.freeze({
    initial: resultFor(3.0, BASELINE.constant, BASELINE.impervious).summary.finalRunoffIn,
    constant: resultFor(BASELINE.initial, 0.50, BASELINE.impervious).summary.finalRunoffIn,
    impervious: resultFor(BASELINE.initial, BASELINE.constant, 50).summary.totalLossIn,
    combined: resultFor(2.0, 0.35, 50)
  });
  TARGETS.combined.time50Hr = Model.firstCrossingTime(
    TARGETS.combined.result.timeHr,
    Model.cumulativeRunoffPercent(TARGETS.combined.result),
    50
  );

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Required element was not found: ${id}`);
    }
    return element;
  }

  function formatSigned(value, digits, unit) {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(digits)} ${unit}`;
  }

  function setMetric(container, title, value, subtitle) {
    container.querySelector(".metric-title").textContent = title;
    container.querySelector(".metric-value").textContent = value;
    container.querySelector(".metric-subtitle").textContent = subtitle;
  }

  function updateSliderReadouts() {
    elements.initialLossValue.textContent = `${Number(elements.initialLoss.value).toFixed(1)} in`;
    elements.constantLossValue.textContent = `${Number(elements.constantLoss.value).toFixed(2)} in/hr`;
    elements.imperviousValue.textContent = `${Number(elements.impervious.value).toFixed(0)}%`;
  }

  function setTrainingControls(activeControls, values) {
    const active = new Set(activeControls);
    const settings = values || BASELINE;
    elements.initialLoss.value = settings.initial;
    elements.constantLoss.value = settings.constant;
    elements.impervious.value = settings.impervious;
    elements.initialLoss.disabled = !active.has("initial");
    elements.constantLoss.disabled = !active.has("constant");
    elements.impervious.disabled = !active.has("impervious");
    scheduleRender();
  }

  function renderCheckpointCurrent(body, options) {
    body.replaceChildren();
    body.className = "checkpoint-body checkpoint-current-grid";
    const cards = options.timing ? [
      ["Current final runoff", "cp-current-volume"],
      ["Current time to 50% runoff", "cp-current-timing"]
    ] : [[options.label, "cp-current-volume"]];
    cards.forEach(([label, id]) => {
      const card = document.createElement("div");
      card.className = "checkpoint-current";
      const title = document.createElement("strong");
      title.textContent = label;
      const value = document.createElement("span");
      value.id = id;
      value.textContent = "--";
      card.append(title, value);
      body.appendChild(card);
    });
    setTrainingControls(options.active, options.values || BASELINE);
  }

  function volumeEvaluation(actual, target, concept) {
    const evaluation = Checkpoints.evaluateNumeric(actual, target, { absolute: 0.10, percent: 1.5, closeMultiplier: 2.5 });
    if (evaluation.status === Checkpoints.RESULT.ACCEPTABLE) {
      return { status: evaluation.status, storedResult: { targetRunoffIn: target, actualRunoffIn: actual } };
    }
    if (evaluation.status === Checkpoints.RESULT.CLOSE) {
      return { status: evaluation.status, message: `Close. Make one small ${concept} adjustment and watch the final volume.` };
    }
    return { status: evaluation.status, message: actual > target ? `Runoff is too high. Use ${concept} to retain more rainfall.` : `Runoff is too low. Use ${concept} to retain less rainfall.` };
  }

  function currentResult() {
    return resultFor(elements.initialLoss.value, elements.constantLoss.value, elements.impervious.value);
  }

  function initializeCheckpoints() {
    const checkpoints = [
      {
        id: "initial-loss",
        title: "Isolate initial loss",
        task: `Using only initial loss, reach ${TARGETS.initial.toFixed(2)} inches of final runoff. Constant loss remains ${BASELINE.constant.toFixed(2)} in/hr and impervious area remains ${BASELINE.impervious}%.`,
        render: body => renderCheckpointCurrent(body, { label: "Current final runoff", active: ["initial"], values: BASELINE }),
        evaluate: () => {
          const current = currentResult().summary.finalRunoffIn;
          const result = volumeEvaluation(current, TARGETS.initial, "initial loss");
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) result.message = "Checkpoint complete. Initial loss removes a fixed depth before constant loss begins, delaying the start of pervious runoff and reducing its volume.";
          return result;
        },
        takeaway: "Initial loss is a one-time abstraction that must be satisfied before pervious runoff begins."
      },
      {
        id: "constant-loss",
        title: "Isolate the constant loss rate",
        task: `Using only constant loss rate, reach ${TARGETS.constant.toFixed(2)} inches of final runoff. Initial loss remains ${BASELINE.initial.toFixed(1)} in and impervious area remains ${BASELINE.impervious}%.`,
        render: body => renderCheckpointCurrent(body, { label: "Current final runoff", active: ["constant"], values: BASELINE }),
        evaluate: () => {
          const current = currentResult().summary.finalRunoffIn;
          const result = volumeEvaluation(current, TARGETS.constant, "constant loss rate");
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) result.message = "Checkpoint complete. Unlike the fixed initial abstraction, constant loss continues removing pervious rainfall at a rate after initial loss is satisfied.";
          return result;
        },
        takeaway: "Constant loss is rate-limited and continues through the storm whenever pervious rainfall is available."
      },
      {
        id: "impervious",
        title: "Isolate percent impervious",
        task: `Using only percent impervious, reach ${TARGETS.impervious.toFixed(2)} inches of total loss. Initial loss remains ${BASELINE.initial.toFixed(1)} in and constant loss remains ${BASELINE.constant.toFixed(2)} in/hr.`,
        render: body => renderCheckpointCurrent(body, { label: "Current total loss", active: ["impervious"], values: BASELINE }),
        evaluate: () => {
          const current = currentResult().summary.totalLossIn;
          const result = volumeEvaluation(current, TARGETS.impervious, "percent impervious");
          if (result.status === Checkpoints.RESULT.ACCEPTABLE) result.message = "Checkpoint complete. Increasing impervious area bypasses the pervious loss process, so a smaller share of total rainfall can be abstracted.";
          else if (result.status === Checkpoints.RESULT.INCORRECT) result.message = current > TARGETS.impervious ? "Total loss is too high. Increase impervious area so more rainfall bypasses pervious losses." : "Total loss is too low. Decrease impervious area so more rainfall is exposed to pervious losses.";
          return result;
        },
        takeaway: "Imperviousness changes which fraction of rainfall is even available to the initial-and-constant loss calculation."
      },
      {
        id: "combined",
        title: "Combine volume and timing controls",
        task: `Adjust all three controls to reach ${TARGETS.combined.summary.finalRunoffIn.toFixed(2)} inches of final runoff and reach 50% cumulative runoff at ${TARGETS.combined.time50Hr.toFixed(2)} hours.`,
        render: body => renderCheckpointCurrent(body, { timing: true, active: ["initial", "constant", "impervious"], values: BASELINE }),
        evaluate: () => {
          const current = currentResult();
          const currentTime = Model.firstCrossingTime(current.result.timeHr, Model.cumulativeRunoffPercent(current.result), 50);
          const volume = Checkpoints.evaluateNumeric(current.summary.finalRunoffIn, TARGETS.combined.summary.finalRunoffIn, { absolute: 0.12, percent: 2, closeMultiplier: 2.5 });
          const timing = Checkpoints.evaluateNumeric(currentTime, TARGETS.combined.time50Hr, { absolute: 0.30, percent: 2, closeMultiplier: 2.5 });
          if (volume.status === Checkpoints.RESULT.ACCEPTABLE && timing.status === Checkpoints.RESULT.ACCEPTABLE) {
            return { status: Checkpoints.RESULT.ACCEPTABLE, message: "Challenge complete. Multiple parameter combinations may give similar total runoff, but timing provides a second constraint that exposes how the losses were achieved." };
          }
          if ([volume.status, timing.status].every(status => [Checkpoints.RESULT.ACCEPTABLE, Checkpoints.RESULT.CLOSE].includes(status))) {
            return { status: Checkpoints.RESULT.CLOSE, message: "Both metrics are close. Make a small adjustment while watching whether it changes volume, timing, or both." };
          }
          const misses = [];
          if (volume.status !== Checkpoints.RESULT.ACCEPTABLE) misses.push("final volume");
          if (timing.status !== Checkpoints.RESULT.ACCEPTABLE) misses.push("50% runoff timing");
          return { status: Checkpoints.RESULT.INCORRECT, message: `Rework the ${misses.join(" and ")}. Initial and constant loss influence when pervious runoff begins; imperviousness supplies immediate runoff that bypasses both.` };
        },
        takeaway: "A plausible loss calibration should be checked against both runoff volume and response timing."
      }
    ];

    checkpointFlow = new Checkpoints.CheckpointFlow({
      moduleId: "losses",
      checkpoints,
      elements: {
        number: byId("checkpoint-number"), title: byId("checkpoint-title"), task: byId("checkpoint-task"),
        body: byId("checkpoint-body"), feedback: byId("checkpoint-feedback"), checkButton: byId("checkpoint-check"),
        nextButton: byId("checkpoint-next"), resetButton: byId("checkpoint-reset"), progress: byId("checkpoint-progress"),
        completeMessage: byId("checkpoint-complete")
      },
      onUnlock: unlocked => {
        byId("sandbox-lock").hidden = unlocked;
        if (unlocked) [elements.initialLoss, elements.constantLoss, elements.impervious].forEach(input => { input.disabled = false; });
      },
      onReset: () => setTrainingControls(["initial"], BASELINE)
    });
  }

  function renderGoalTable(rows) {
    elements.goalTableBody.replaceChildren();

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const tolerance = row.kind === "final" ? 0.5 : 0.25;
      const isHit = row.miss !== null && Math.abs(row.miss) <= tolerance;
      tr.classList.toggle("goal-final", row.kind === "final");
      tr.classList.toggle("goal-hit", isHit);
      tr.classList.toggle("goal-miss", row.miss !== null && !isHit);

      const targetText = row.kind === "final"
        ? `${row.targetPct.toFixed(0)}% final runoff`
        : `${row.targetPct.toFixed(0)}% runoff`;
      const currentTimeText = row.currentTimeHr === null
        ? "Not reached"
        : `${row.currentTimeHr.toFixed(row.kind === "final" ? 0 : 2)} hr`;
      const missText = row.miss === null
        ? "--"
        : formatSigned(row.miss, 2, row.missUnit);

      [
        targetText,
        `${row.targetTimeHr.toFixed(0)} hr`,
        currentTimeText,
        missText,
      ].forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });

      elements.goalTableBody.appendChild(tr);
    });
  }

  function render() {
    updateQueued = false;
    updateSliderReadouts();

    const result = Model.computeInitialConstantLosses(
      elements.initialLoss.value,
      elements.constantLoss.value,
      elements.impervious.value
    );
    const summary = Model.summarizeResult(result);
    const checkpointVolume = document.getElementById("cp-current-volume");
    if (checkpointVolume) {
      const currentId = checkpointFlow ? checkpointFlow.current().id : "";
      checkpointVolume.textContent = currentId === "impervious" ? `${summary.totalLossIn.toFixed(2)} in` : `${summary.finalRunoffIn.toFixed(2)} in`;
    }
    const checkpointTiming = document.getElementById("cp-current-timing");
    if (checkpointTiming) {
      const crossing = Model.firstCrossingTime(result.timeHr, Model.cumulativeRunoffPercent(result), 50);
      checkpointTiming.textContent = crossing === null ? "Not reached" : `${crossing.toFixed(2)} hr`;
    }

    setMetric(
      elements.metricRunoff,
      "Final Runoff",
      `${summary.finalRunoffPct.toFixed(1)}%`,
      `${summary.finalRunoffIn.toFixed(2)} in of ${Model.TOTAL_RAINFALL_IN.toFixed(2)} in`
    );
    setMetric(
      elements.metricLoss,
      "Final Loss",
      `${summary.totalLossPct.toFixed(1)}%`,
      `${summary.totalLossIn.toFixed(2)} in total loss`
    );
    setMetric(
      elements.metricImpervious,
      "Impervious Runoff",
      `${summary.imperviousRunoffPct.toFixed(1)}%`,
      `${summary.imperviousRunoffIn.toFixed(2)} in bypassed losses`
    );

    renderGoalTable(Model.makeGoalRows(result));
    Charts.renderCumulativePlot(elements.cumulativePlot, result);
    Charts.renderIncrementalPlot(elements.incrementalPlot, result);
  }

  function scheduleRender() {
    if (updateQueued) {
      return;
    }
    updateQueued = true;
    window.requestAnimationFrame(render);
  }

  function initialize() {
    elements.initialLoss = byId("initial-loss-slider");
    elements.constantLoss = byId("constant-loss-slider");
    elements.impervious = byId("impervious-slider");
    elements.initialLossValue = byId("initial-loss-value");
    elements.constantLossValue = byId("constant-loss-value");
    elements.imperviousValue = byId("impervious-value");
    elements.metricRunoff = byId("metric-runoff");
    elements.metricLoss = byId("metric-loss");
    elements.metricImpervious = byId("metric-impervious");
    elements.goalTableBody = byId("goal-table-body");
    elements.cumulativePlot = byId("cumulative-plot");
    elements.incrementalPlot = byId("incremental-plot");

    [elements.initialLoss, elements.constantLoss, elements.impervious].forEach((input) => {
      input.addEventListener("input", scheduleRender);
      input.addEventListener("change", scheduleRender);
    });

    initializeCheckpoints();

    window.addEventListener("resize", () => {
      Charts.resize(elements.cumulativePlot);
      Charts.resize(elements.incrementalPlot);
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
