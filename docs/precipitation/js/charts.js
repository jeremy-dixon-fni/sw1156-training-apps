(function (global) {
  "use strict";

  const FNI = Object.freeze({
    blue: "#015D91",
    green: "#A9C945",
    navy: "#093D5E",
    orange: "#E05126",
    neutralBlue: "#93AFB4",
    darkGray: "#4D4D4F"
  });

  const PLOT_CONFIG = Object.freeze({
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
  });

  function emptyLayout(title, height) {
    return {
      title: { text: title, x: 0, xanchor: "left" },
      height: height || 420,
      template: "plotly_white",
      font: { family: "Arial, sans-serif", color: FNI.navy },
      margin: { l: 60, r: 30, t: 75, b: 55 },
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [{
        text: "No results",
        showarrow: false,
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        font: { size: 16, color: FNI.darkGray }
      }]
    };
  }

  function renderEmpty(elementId, title, height) {
    return Plotly.react(elementId, [], emptyLayout(title, height), PLOT_CONFIG);
  }

  function renderIdf(elementId, atlas, generatedIdf) {
    const model = global.PrecipModel;
    const constants = model.CONSTANTS;
    const maxDuration = constants.MAX_ATLAS_DURATION_MIN;

    const atlasRows = atlas.depthTable
      .filter((row) => Number.isFinite(row.durationMin) && row.durationMin > 0 && row.durationMin <= maxDuration + 1e-9);
    const processedRows = generatedIdf
      .filter((row) => Number.isFinite(row.durationMin) && row.durationMin > 0 && row.durationMin <= maxDuration + 1e-9)
      .sort((a, b) => a.durationMin - b.durationMin);

    const durations = [...new Set(atlasRows.map((row) => row.durationMin))].sort((a, b) => a - b);
    if (!durations.length) {
      return renderEmpty(elementId, "Atlas 14 IDF Curve Comparisons", 650);
    }

    const traces = [];
    atlas.returnPeriods.forEach((ari, index) => {
      const part = atlasRows
        .filter((row) => Math.abs(row.ariYr - ari) <= 1e-9)
        .sort((a, b) => a.durationMin - b.durationMin);
      if (!part.length) {
        return;
      }
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        x: part.map((row) => row.durationMin),
        y: part.map((row) => row.intensityInHr),
        name: `${ari}-yr`,
        opacity: 0.3,
        line: {
          color: constants.ATLAS_LINE_COLORS[index % constants.ATLAS_LINE_COLORS.length],
          width: Math.abs(ari - constants.REFERENCE_ARI_YR) <= 1e-9 ? 3 : 2
        },
        marker: { size: 5 },
        customdata: part.map((row) => row.duration),
        hovertemplate: "Duration: %{customdata}<br>Intensity: %{y:.3f} in/hr<extra></extra>"
      });
    });

    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: processedRows.map((row) => row.durationMin),
      y: processedRows.map((row) => row.generatedIntensityInHr),
      name: "Processed storm",
      line: { color: "#000000", width: 5, dash: "dash" },
      marker: { size: 8, symbol: "diamond", color: "#000000" },
      customdata: processedRows.map((row) => row.duration),
      hovertemplate: "Duration: %{customdata}<br>Generated intensity: %{y:.3f} in/hr<extra></extra>"
    });

    const layout = {
      title: {
        text: "Atlas 14 IDF Curve Comparisons",
        x: 0,
        xanchor: "left",
        y: 0.98,
        yanchor: "top",
        font: { size: 20 }
      },
      height: 650,
      template: "plotly_white",
      font: { family: "Arial, sans-serif", color: FNI.navy },
      xaxis: {
        title: "Duration",
        type: "log",
        range: [Math.log10(durations[0]), Math.log10(maxDuration)],
        tickmode: "array",
        tickvals: durations,
        ticktext: durations.map(model.formatDuration),
        showgrid: true,
        automargin: true
      },
      yaxis: {
        title: "Precipitation intensity (in/hr)",
        type: "log",
        automargin: true
      },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.08,
        xanchor: "left",
        x: 0,
        font: { size: 12 },
        itemsizing: "constant"
      },
      margin: { l: 78, r: 35, t: 150, b: 100 },
      hovermode: "closest"
    };

    return Plotly.react(elementId, traces, layout, PLOT_CONFIG);
  }

  function renderHyetograph(elementId, storm) {
    const timeHours = storm.timeMidMin.map((value) => value / 60);
    const intensity = storm.incrementalDepthIn.map((value) => value / (storm.timestepMin / 60));
    const customdata = intensity.map((value, index) => [value, storm.cumulativeDepthIn[index]]);

    const traces = [
      {
        type: "bar",
        x: timeHours,
        y: storm.incrementalDepthIn,
        width: storm.timestepMin / 60,
        name: "Incremental rainfall depth",
        marker: { color: FNI.blue },
        customdata,
        hovertemplate:
          "Time: %{x:.2f} hr<br>" +
          "Increment: %{y:.3f} in<br>" +
          "Intensity: %{customdata[0]:.2f} in/hr<br>" +
          "Cumulative: %{customdata[1]:.3f} in<extra></extra>"
      },
      {
        type: "scatter",
        mode: "lines",
        x: timeHours,
        y: storm.cumulativeDepthIn,
        name: "Cumulative rainfall",
        yaxis: "y2",
        line: { color: FNI.green, width: 3 },
        hovertemplate: "Time: %{x:.2f} hr<br>Cumulative: %{y:.3f} in<extra></extra>"
      }
    ];

    const layout = {
      title: {
        text: `Generated 24-hour Hyetograph - ${storm.method}`,
        x: 0,
        xanchor: "left"
      },
      height: 500,
      template: "plotly_white",
      font: { family: "Arial, sans-serif", color: FNI.navy },
      xaxis: { title: "Time from storm start (hr)", automargin: true },
      yaxis: { title: "Incremental depth per 5-min block (in)", automargin: true },
      yaxis2: {
        title: "Cumulative depth (in)",
        overlaying: "y",
        side: "right",
        automargin: true
      },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.02,
        xanchor: "right",
        x: 1
      },
      margin: { l: 70, r: 78, t: 85, b: 65 },
      bargap: 0,
      hovermode: "closest"
    };

    return Plotly.react(elementId, traces, layout, PLOT_CONFIG);
  }

  function resize(elementId) {
    const element = document.getElementById(elementId);
    if (element && element.data) {
      Plotly.Plots.resize(element);
    }
  }

  global.PrecipCharts = Object.freeze({
    FNI,
    renderEmpty,
    renderIdf,
    renderHyetograph,
    resize
  });
})(window);
