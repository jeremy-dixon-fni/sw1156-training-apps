/* Plotly figure construction for the Transform Flow Path Explorer. */
(function (globalScope, factory) {
  const api = factory(globalScope.TransformModel, globalScope.Plotly);
  if (typeof module === "object" && module.exports) module.exports = api;
  globalScope.TransformCharts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model, PlotlyLibrary) {
  "use strict";

  if (!Model) throw new Error("TransformModel must be loaded before charts.js.");

  const plotConfig = Object.freeze({
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
  });

  function dateObjects() {
    return Model.EVENT_TIMESTAMPS_MS.map(value => new Date(value));
  }

  function baseLayout(title) {
    return {
      title: { text: title, x: 0.02, xanchor: "left", font: { size: 20, color: Model.COLORS.FNI_NAVY } },
      template: "plotly_white",
      hovermode: "x unified",
      margin: { l: 70, r: 215, t: 70, b: 60 },
      height: 510,
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      font: { family: "Arial, sans-serif", color: Model.COLORS.FNI_DARK_GRAY },
      xaxis: {
        title: "Time",
        range: [new Date(Model.EVENT_TIMESTAMPS_MS[0]), new Date(Model.EVENT_TIMESTAMPS_MS.at(-1))],
        tickformat: "%d %b\n%H:%M",
        gridcolor: "#e7ecef",
        showgrid: true,
        zeroline: false
      },
      yaxis: {
        title: "Flow (cfs)",
        rangemode: "tozero",
        gridcolor: "#e7ecef",
        zeroline: false,
        tickformat: ",.0f"
      },
      legend: {
        orientation: "v",
        yanchor: "top",
        y: 1,
        xanchor: "left",
        x: 1.01,
        bgcolor: "rgba(255,255,255,0.75)"
      }
    };
  }

  function buildMethodFigure(results) {
    const x = dateObjects();
    const data = [];
    for (const result of results) {
      const pathId = result.pathId;
      const controlling = Boolean(result.isControlling);
      data.push({
        type: "scatter",
        mode: "lines",
        x,
        y: result.hydrographCfs,
        name: `Flow Path ${pathId}${controlling ? " - controlling Tc" : ""}`,
        line: {
          color: Model.PATH_COLORS[pathId],
          width: controlling ? 5 : 2.8,
          dash: controlling ? "solid" : "dot"
        },
        hovertemplate: `<b>Flow Path ${pathId}</b><br>%{x|%d %b %H:%M}<br>%{y:,.0f} cfs<extra></extra>`
      });
      data.push({
        type: "scatter",
        mode: "markers",
        x: [new Date(result.peakTimestampMs)],
        y: [result.peakFlowCfs],
        name: `Path ${pathId} peak`,
        showlegend: false,
        marker: {
          color: Model.PATH_COLORS[pathId],
          size: controlling ? 12 : 8,
          line: { color: "white", width: 1.5 }
        },
        hovertemplate: `<b>Path ${pathId} peak</b><br>%{x|%d %b %H:%M}<br>%{y:,.0f} cfs<extra></extra>`
      });
    }
    return {
      data,
      layout: baseLayout("Runoff Hydrographs from the Same Excess Precipitation"),
      config: plotConfig
    };
  }

  function buildTransformFigure(sensitivity) {
    const x = dateObjects();
    const selected = sensitivity.selected;
    const data = [
      {
        type: "scatter",
        mode: "lines",
        x,
        y: sensitivity.envelopeMinCfs,
        line: { color: "rgba(169,201,69,0)", width: 0 },
        hoverinfo: "skip",
        showlegend: false
      },
      {
        type: "scatter",
        mode: "lines",
        x,
        y: sensitivity.envelopeMaxCfs,
        line: { color: "rgba(169,201,69,0.35)", width: 1 },
        fill: "tonexty",
        fillcolor: "rgba(169,201,69,0.28)",
        name: "All allowable lag-ratio / PRF combinations",
        hovertemplate: "%{x|%d %b %H:%M}<br>Envelope upper bound: %{y:,.0f} cfs<extra></extra>"
      },
      {
        type: "scatter",
        mode: "lines",
        x,
        y: selected.hydrographCfs,
        name: `Selected: lag ratio ${selected.lagRatio.toFixed(2)}, PRF ${selected.peakRateFactor.toFixed(0)}`,
        line: { color: Model.COLORS.FNI_BLUE, width: 4 },
        hovertemplate: "<b>Selected solution</b><br>%{x|%d %b %H:%M}<br>%{y:,.0f} cfs<extra></extra>"
      },
      {
        type: "scatter",
        mode: "markers",
        x: [new Date(selected.peakTimestampMs)],
        y: [selected.peakFlowCfs],
        name: "Selected peak",
        showlegend: false,
        marker: {
          color: Model.COLORS.FNI_BLUE,
          size: 12,
          line: { color: "white", width: 1.5 }
        },
        hovertemplate: "<b>Selected peak</b><br>%{x|%d %b %H:%M}<br>%{y:,.0f} cfs<extra></extra>"
      }
    ];
    const layout = baseLayout("Lag Ratio and Peak Rate Factor Sensitivity");
    layout.margin.r = 290;
    return { data, layout, config: plotConfig };
  }

  function render(container, figure) {
    if (!PlotlyLibrary || typeof PlotlyLibrary.react !== "function") {
      throw new Error("Plotly was not loaded.");
    }
    return PlotlyLibrary.react(container, figure.data, figure.layout, figure.config);
  }

  function renderError(container, message) {
    const figure = {
      data: [],
      layout: {
        template: "plotly_white",
        height: 510,
        margin: { l: 40, r: 40, t: 60, b: 40 },
        title: { text: "Calculation error", x: 0.02 },
        annotations: [{
          text: String(message),
          xref: "paper",
          yref: "paper",
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: { color: Model.COLORS.FNI_ORANGE, size: 15 }
        }]
      },
      config: plotConfig
    };
    return render(container, figure);
  }

  return Object.freeze({
    plotConfig,
    buildMethodFigure,
    buildTransformFigure,
    render,
    renderError
  });
});
