(function () {
  "use strict";

  const Model = window.LossesModel;
  const Charts = window.LossesCharts;

  if (!Model || !Charts) {
    throw new Error("The model and chart scripts must load before app.js.");
  }

  const elements = {};
  let updateQueued = false;

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
