(function (root, factory) {
  const api = factory(root.LossesModel);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LossesCharts = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model) {
  "use strict";

  const COLORS = Object.freeze({
    blue: "#015D91",
    green: "#A9C945",
    yellow: "#DEB326",
    orange: "#E05126",
    navy: "#093D5E",
  });

  const PLOT_CONFIG = Object.freeze({
    displayModeBar: false,
    responsive: true,
    scrollZoom: false,
  });

  function requirePlotly() {
    if (typeof Plotly === "undefined") {
      throw new Error("Plotly is not available. Confirm vendor/plotly.min.js is loaded first.");
    }
  }

  function commonLayout() {
    return {
      template: "plotly_white",
      font: { family: "Arial, sans-serif", color: COLORS.navy },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.02,
        xanchor: "right",
        x: 1,
      },
      hoverlabel: { namelength: -1 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "white",
    };
  }

  function renderIncrementalPlot(element, result) {
    requirePlotly();
    const traces = [
      {
        type: "bar",
        x: result.timeHr,
        y: result.rainfallIn,
        name: "Incremental rainfall",
        marker: { color: COLORS.blue, opacity: 0.35 },
        width: Model.DT_HR * 0.82,
        hovertemplate: "Time: %{x:.2f} hr<br>Rainfall: %{y:.3f} in<extra></extra>",
      },
      {
        type: "bar",
        x: result.timeHr,
        y: result.initialLossIn,
        name: "Initial loss",
        marker: { color: COLORS.orange },
        width: Model.DT_HR * 0.58,
        hovertemplate: "Time: %{x:.2f} hr<br>Initial loss: %{y:.3f} in<extra></extra>",
      },
      {
        type: "bar",
        x: result.timeHr,
        y: result.constantLossIn,
        name: "Constant loss",
        marker: { color: COLORS.yellow },
        width: Model.DT_HR * 0.58,
        hovertemplate: "Time: %{x:.2f} hr<br>Constant loss: %{y:.3f} in<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: result.totalRunoffIn,
        name: "Incremental runoff",
        line: { color: COLORS.navy, width: 3 },
        hovertemplate: "Time: %{x:.2f} hr<br>Runoff: %{y:.3f} in<extra></extra>",
      },
    ];

    const layout = {
      ...commonLayout(),
      title: { text: "Incremental Rainfall, Losses, and Runoff", x: 0.02, xanchor: "left" },
      xaxis: { title: "Time (hr)", range: [0, Model.STORM_DURATION_HR + Model.DT_HR] },
      yaxis: { title: "Incremental depth (in)", rangemode: "tozero" },
      barmode: "overlay",
      margin: { l: 60, r: 25, t: 78, b: 55 },
      autosize: true,
    };

    return Plotly.react(element, traces, layout, PLOT_CONFIG);
  }

  function renderCumulativePlot(element, result) {
    requirePlotly();
    const percent = (values) => values.map((value) => (value / Model.TOTAL_RAINFALL_IN) * 100.0);
    const targetPoints = [
      ...Model.CHECKPOINT_TARGETS,
      { targetPct: Model.FINAL_TARGET_PCT, targetTimeHr: Model.FINAL_TARGET_TIME_HR },
    ];

    const traces = [
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: percent(result.cumulativeRainfallIn),
        name: "Cumulative rainfall",
        line: { color: COLORS.blue, width: 4 },
        hovertemplate: "Time: %{x:.2f} hr<br>Rainfall: %{y:.1f}%<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: percent(result.cumulativeRunoffIn),
        name: "Cumulative runoff",
        line: { color: COLORS.green, width: 4 },
        hovertemplate: "Time: %{x:.2f} hr<br>Runoff: %{y:.1f}%<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: percent(result.cumulativeTotalLossIn),
        name: "Cumulative total loss",
        line: { color: COLORS.orange, width: 3 },
        hovertemplate: "Time: %{x:.2f} hr<br>Total loss: %{y:.1f}%<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: percent(result.cumulativeInitialLossIn),
        name: "Cumulative initial loss",
        line: { color: COLORS.orange, width: 2, dash: "dot" },
        visible: "legendonly",
        hovertemplate: "Time: %{x:.2f} hr<br>Initial loss: %{y:.1f}%<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: result.timeHr,
        y: percent(result.cumulativeConstantLossIn),
        name: "Cumulative constant loss",
        line: { color: COLORS.yellow, width: 2, dash: "dot" },
        visible: "legendonly",
        hovertemplate: "Time: %{x:.2f} hr<br>Constant loss: %{y:.1f}%<extra></extra>",
      },
      {
        type: "scatter",
        mode: "markers+text",
        x: targetPoints.map((point) => point.targetTimeHr),
        y: targetPoints.map((point) => point.targetPct),
        text: targetPoints.map((point) => `${point.targetPct.toFixed(0)}%`),
        textposition: "top center",
        name: "Runoff targets",
        marker: {
          color: COLORS.orange,
          size: 11,
          symbol: "x",
          line: { width: 2 },
        },
        hovertemplate: "Target: %{y:.0f}% runoff<br>Time: %{x:.0f} hr<extra></extra>",
      },
    ];

    const layout = {
      ...commonLayout(),
      title: { text: "Cumulative Rainfall, Runoff, Losses, and Targets", x: 0.02, xanchor: "left" },
      xaxis: { title: "Time (hr)", range: [0, Model.STORM_DURATION_HR + Model.DT_HR] },
      yaxis: { title: "Cumulative depth (% of 10-inch storm)", range: [0, 105] },
      margin: { l: 68, r: 25, t: 82, b: 58 },
      autosize: true,
    };

    return Plotly.react(element, traces, layout, PLOT_CONFIG);
  }

  function resize(element) {
    if (typeof Plotly !== "undefined" && element) {
      Plotly.Plots.resize(element);
    }
  }

  return Object.freeze({
    COLORS,
    renderIncrementalPlot,
    renderCumulativePlot,
    resize,
  });
});
