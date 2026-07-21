(function (global) {
  "use strict";

  const CONSTANTS = Object.freeze({
    TIMESTEP_MIN: 5,
    STORM_DURATION_HR: 24,
    STORM_DURATION_MIN: 24 * 60,
    MAX_ATLAS_DURATION_MIN: 2 * 24 * 60,
    REFERENCE_ARI_YR: 100,
    MANUAL_DEPTH_DURATIONS_MIN: Object.freeze([5, 15, 60, 120, 180, 360, 720, 1440]),
    DEPTH_TOL_IN: 0.01,
    ATLAS_LINE_COLORS: Object.freeze([
      "#00b050",
      "#ff9900",
      "#ff6600",
      "#ff0000",
      "#ff00ff",
      "#8000ff",
      "#0000ff",
      "#00a6ff",
      "#00cfd4",
      "#333333"
    ])
  });

  const SAMPLE_ATLAS14_CSV = `Point precipitation frequency estimates (inches)
NOAA Atlas 14 Volume 11 Version 2
Data type: Precipitation depth
Time series type: Partial duration
Project area: Texas
Location name (ESRI Maps): Irving, Texas, USA
Station Name: -
Latitude: 32.8687 Degree
Longitude: -96.9737 Degree
Elevation (USGS): 497 ft


PRECIPITATION FREQUENCY ESTIMATES
by duration for ARI (years):, 1,2,5,10,25,50,100,200,500,1000
5-min:, 0.421,0.489,0.601,0.693,0.818,0.912,1.01,1.10,1.24,1.34
10-min:, 0.674,0.783,0.964,1.11,1.31,1.47,1.62,1.77,1.96,2.11
15-min:, 0.840,0.975,1.20,1.38,1.63,1.82,2.00,2.20,2.45,2.64
30-min:, 1.17,1.35,1.66,1.91,2.25,2.50,2.76,3.03,3.38,3.66
60-min:, 1.52,1.76,2.17,2.50,2.95,3.29,3.63,4.00,4.50,4.90
2-hr:, 1.85,2.18,2.70,3.14,3.76,4.23,4.71,5.24,5.96,6.54
3-hr:, 2.05,2.43,3.03,3.55,4.27,4.83,5.42,6.06,6.95,7.66
6-hr:, 2.41,2.89,3.63,4.27,5.18,5.91,6.68,7.51,8.67,9.60
12-hr:, 2.82,3.39,4.28,5.05,6.14,7.01,7.93,8.93,10.3,11.5
24-hr:, 3.29,3.95,5.00,5.89,7.17,8.19,9.27,10.4,12.1,13.5
2-day:, 3.82,4.59,5.80,6.84,8.32,9.49,10.7,12.1,14.0,15.6

Date/time (GMT):  Wed Jun 10 16:58:01 2026
pyRunTime:  0.0074803829193115234
`;

  const BUILTIN_DISTRIBUTION_CSVS = Object.freeze({
    "SCS-type-ii.csv": `# distribution_name: SCS Type II - approximate legacy
# source_note: Approximate legacy SCS-style 24-hour cumulative distribution. Replace with a verified agency table before production use.
fraction_time,fraction_cumulative_depth
0.0000,0.000
0.0833,0.022
0.1667,0.048
0.2500,0.080
0.2917,0.098
0.3333,0.120
0.3750,0.147
0.4167,0.181
0.4583,0.235
0.4792,0.283
0.4896,0.357
0.5000,0.663
0.5104,0.735
0.5208,0.772
0.5417,0.820
0.5833,0.859
0.6667,0.899
0.7500,0.928
0.8333,0.955
0.9167,0.978
1.0000,1.000
`,
    "SCS-type-iii.csv": `# distribution_name: SCS Type III - approximate legacy
# source_note: Approximate legacy SCS-style 24-hour cumulative distribution. Replace with a verified agency table before production use.
fraction_time,fraction_cumulative_depth
0.0000,0.000
0.0833,0.020
0.1667,0.043
0.2500,0.072
0.3333,0.112
0.3750,0.142
0.4167,0.182
0.4583,0.245
0.4792,0.318
0.4896,0.410
0.5000,0.510
0.5104,0.600
0.5208,0.682
0.5417,0.755
0.5833,0.820
0.6667,0.888
0.7500,0.930
0.8333,0.960
0.9167,0.982
1.0000,1.000
`
  });

  function cleanCell(value) {
    return String(value == null ? "" : value).replace(/^\uFEFF/, "").trim();
  }

  function normalizeHeader(name) {
    return String(name == null ? "" : name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function sourceStem(source) {
    const clean = String(source || "distribution").split(/[?#]/)[0];
    const leaf = clean.split(/[\\/]/).pop() || "distribution";
    return leaf.replace(/\.[^.]+$/, "");
  }

  function almostEqual(a, b, tolerance) {
    const tol = tolerance == null ? 1e-9 : tolerance;
    return Math.abs(Number(a) - Number(b)) <= tol;
  }

  function safeNumber(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }
    const out = Number(value);
    return Number.isFinite(out) ? out : fallback;
  }

  function roundNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return null;
    }
    const scale = 10 ** (digits == null ? 3 : digits);
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }

  function cumulativeMaximum(values) {
    const output = [];
    let current = -Infinity;
    values.forEach((value) => {
      current = Math.max(current, value);
      output.push(current);
    });
    return output;
  }

  function arraySum(values) {
    return values.reduce((sum, value) => sum + value, 0);
  }

  function argMax(values) {
    if (!values.length) {
      return -1;
    }
    let index = 0;
    let best = values[0];
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > best) {
        best = values[i];
        index = i;
      }
    }
    return index;
  }

  function parseCsvRows(text) {
    const source = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];

      if (inQuotes) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    return rows;
  }

  function normalizePossibleCommentLine(rawLine) {
    let line = String(rawLine == null ? "" : rawLine).trim().replace(/^\uFEFF/, "");
    if (line.startsWith('"') && line.endsWith('",')) {
      line = line.slice(1, -2).replace(/""/g, '"').trim();
    } else if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).replace(/""/g, '"').trim();
    }
    if (line.endsWith(",")) {
      line = line.slice(0, -1).trim();
    }
    return line;
  }

  function extractDistributionMetadata(text) {
    const metadata = {};
    String(text == null ? "" : text).split(/\r?\n/).forEach((rawLine) => {
      const line = normalizePossibleCommentLine(rawLine);
      if (!line.startsWith("#")) {
        return;
      }
      const content = line.slice(1).trim();
      const colon = content.indexOf(":");
      if (colon < 0) {
        return;
      }
      const key = normalizeHeader(content.slice(0, colon));
      const value = content.slice(colon + 1).trim().replace(/^"|"$/g, "").replace(/,$/, "").trim();
      metadata[key] = value;
    });
    return metadata;
  }

  function stripDistributionCommentLines(text) {
    return String(text == null ? "" : text)
      .split(/\r?\n/)
      .filter((rawLine) => !normalizePossibleCommentLine(rawLine).startsWith("#"))
      .join("\n");
  }

  function parseDistributionCsvText(text, source, fallbackName) {
    const metadata = extractDistributionMetadata(text);
    const rows = parseCsvRows(stripDistributionCommentLines(text)).filter((row) => row.some((cell) => cleanCell(cell)));
    if (!rows.length) {
      throw new Error(`Temporal distribution CSV '${source}' has no data rows.`);
    }

    const header = rows[0].map(normalizeHeader);
    const timeCandidates = [
      "fraction_time",
      "time_fraction",
      "t_fraction",
      "fractional_time",
      "normalized_time",
      "dimensionless_time"
    ];
    const depthCandidates = [
      "fraction_cumulative_depth",
      "cumulative_depth_fraction",
      "cum_depth_fraction",
      "depth_fraction",
      "fraction_depth",
      "fractional_cumulative_depth",
      "normalized_cumulative_depth",
      "dimensionless_cumulative_depth"
    ];

    const timeIndex = timeCandidates.map((name) => header.indexOf(name)).find((index) => index >= 0);
    const depthIndex = depthCandidates.map((name) => header.indexOf(name)).find((index) => index >= 0);
    if (timeIndex === undefined || depthIndex === undefined) {
      throw new Error(
        `Temporal distribution CSV '${source}' must contain columns named fraction_time and ` +
        "fraction_cumulative_depth. Flexible aliases are accepted, but both time and cumulative-depth fractions are required."
      );
    }

    const points = rows.slice(1)
      .map((row) => ({
        fractionTime: Number(cleanCell(row[timeIndex])),
        fractionCumulativeDepth: Number(cleanCell(row[depthIndex]))
      }))
      .filter((point) => Number.isFinite(point.fractionTime) && Number.isFinite(point.fractionCumulativeDepth))
      .sort((a, b) => a.fractionTime - b.fractionTime);

    if (points.length < 2) {
      throw new Error(`Temporal distribution CSV '${source}' must contain at least two valid rows.`);
    }

    let fractionTime = points.map((point) => point.fractionTime);
    let fractionCumulativeDepth = points.map((point) => point.fractionCumulativeDepth);

    if (fractionTime.some((value) => value < -1e-9 || value > 1 + 1e-9)) {
      throw new Error(`Temporal distribution CSV '${source}' has fraction_time values outside 0 to 1.`);
    }
    if (fractionCumulativeDepth.some((value) => value < -1e-9 || value > 1 + 1e-9)) {
      throw new Error(`Temporal distribution CSV '${source}' has cumulative-depth fractions outside 0 to 1.`);
    }
    for (let i = 1; i < fractionTime.length; i += 1) {
      if (fractionTime[i] - fractionTime[i - 1] <= 0) {
        throw new Error(`Temporal distribution CSV '${source}' fraction_time values must be strictly increasing.`);
      }
      if (fractionCumulativeDepth[i] - fractionCumulativeDepth[i - 1] < -1e-9) {
        throw new Error(`Temporal distribution CSV '${source}' cumulative-depth fractions must be nondecreasing.`);
      }
    }

    fractionTime = fractionTime.map((value) => Math.min(1, Math.max(0, value)));
    fractionCumulativeDepth = fractionCumulativeDepth.map((value) => Math.min(1, Math.max(0, value)));

    if (fractionTime[0] > 1e-9) {
      fractionTime.unshift(0);
      fractionCumulativeDepth.unshift(0);
    } else if (Math.abs(fractionCumulativeDepth[0]) > 1e-6) {
      throw new Error(`Temporal distribution CSV '${source}' must start with cumulative depth fraction 0 at time fraction 0.`);
    } else {
      fractionTime[0] = 0;
      fractionCumulativeDepth[0] = 0;
    }

    const lastIndex = fractionTime.length - 1;
    if (fractionTime[lastIndex] < 1 - 1e-9) {
      fractionTime.push(1);
      fractionCumulativeDepth.push(1);
    } else if (Math.abs(fractionCumulativeDepth[lastIndex] - 1) > 1e-6) {
      throw new Error(`Temporal distribution CSV '${source}' must end with cumulative depth fraction 1 at time fraction 1.`);
    } else {
      fractionTime[lastIndex] = 1;
      fractionCumulativeDepth[lastIndex] = 1;
    }

    const embedded = String(source).startsWith("embedded:");
    const stem = sourceStem(embedded ? String(source).split(":", 2)[1] : source);
    const name = embedded
      ? (metadata.distribution_name || metadata.name || fallbackName || stem)
      : (fallbackName || stem);

    return {
      key: normalizeHeader(stem || name),
      name,
      source,
      fractionTime,
      fractionCumulativeDepth: cumulativeMaximum(fractionCumulativeDepth)
    };
  }

  async function loadDistributionLibrary(manifestUrl, baseUrl) {
    const library = {};
    const warnings = [];

    Object.entries(BUILTIN_DISTRIBUTION_CSVS).forEach(([filename, text]) => {
      const distribution = parseDistributionCsvText(text, `embedded:${filename}`, sourceStem(filename));
      library[distribution.key] = distribution;
    });

    try {
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const manifest = await response.json();
      const files = Array.isArray(manifest) ? manifest : manifest.files;
      if (!Array.isArray(files)) {
        throw new Error("Manifest must be an array or contain a files array.");
      }

      for (const filename of files) {
        try {
          const url = `${String(baseUrl).replace(/\/$/, "")}/${filename}`;
          const fileResponse = await fetch(url, { cache: "no-store" });
          if (!fileResponse.ok) {
            throw new Error(`HTTP ${fileResponse.status}`);
          }
          const text = await fileResponse.text();
          const distribution = parseDistributionCsvText(text, url, sourceStem(filename));
          library[distribution.key] = distribution;
        } catch (error) {
          warnings.push(`Could not load temporal distribution '${filename}': ${error.message}`);
        }
      }
    } catch (error) {
      warnings.push(
        `Could not load temporal distribution manifest. Built-in fallback curves are available. ${error.message}`
      );
    }

    return { library, warnings };
  }

  function distributionDropdownOptions(library) {
    const options = Object.entries(library)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([key, distribution]) => ({ label: distribution.name, value: `dist::${key}` }));

    [25, 33, 50, 67, 75].forEach((percent) => {
      options.push({
        label: `Alternating Block - ${percent}% centered`,
        value: `abm_${percent}`
      });
    });
    return options;
  }

  function parseDurationToMinutes(label) {
    const text = cleanCell(label).toLowerCase().replace(/:/g, "");
    const match = text.match(/^([0-9]*\.?[0-9]+)\s*-?\s*(min|minute|minutes|hr|hour|hours|day|days)$/);
    if (!match) {
      throw new Error(`Unsupported duration label: ${label}`);
    }
    const value = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith("min")) {
      return value;
    }
    if (["hr", "hour", "hours"].includes(unit)) {
      return value * 60;
    }
    if (unit.startsWith("day")) {
      return value * 24 * 60;
    }
    throw new Error(`Unsupported duration unit in label: ${label}`);
  }

  function formatDuration(minutes) {
    const value = Number(minutes);
    if (almostEqual(value, 60)) {
      return "60-min";
    }
    if (value < 60) {
      return `${Math.round(value)}-min`;
    }
    if (value <= 24 * 60) {
      return `${Math.round(value / 60)}-hr`;
    }
    return `${Math.round(value / (24 * 60))}-day`;
  }

  function intensityFromDepth(depthIn, durationMin) {
    return Number(depthIn) / (Number(durationMin) / 60);
  }

  function parseAtlas14CsvText(text) {
    const rows = parseCsvRows(text);
    const metadata = {};

    rows.forEach((row) => {
      if (!row.length) {
        return;
      }
      const first = cleanCell(row[0]);
      if (!first.includes(":") || first.toLowerCase().startsWith("by duration for ari")) {
        return;
      }
      const colon = first.indexOf(":");
      const key = first.slice(0, colon).trim();
      let value = first.slice(colon + 1).trim();
      const remaining = row.slice(1).map(cleanCell).filter(Boolean);
      if (value && remaining.length) {
        value = `${value}, ${remaining.join(", ")}`;
      } else if (!value && remaining.length) {
        value = remaining.join(", ");
      }
      if (key && value) {
        metadata[key] = value;
      }
    });

    const headerIndex = rows.findIndex((row) => row.length && cleanCell(row[0]).toLowerCase().startsWith("by duration for ari"));
    if (headerIndex < 0) {
      throw new Error("Could not find the Atlas 14 ARI header row: 'by duration for ARI (years):'.");
    }

    const returnPeriods = rows[headerIndex]
      .slice(1)
      .map(cleanCell)
      .filter(Boolean)
      .map(Number);
    if (!returnPeriods.length || returnPeriods.some((value) => !Number.isFinite(value))) {
      throw new Error("Could not parse Atlas 14 ARI values from the header row.");
    }

    const depthTable = [];
    const durationLabels = [];

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.length || !cleanCell(row[0])) {
        continue;
      }
      const first = cleanCell(row[0]);
      const lower = first.toLowerCase();
      if (lower.startsWith("date/time") || lower.startsWith("pyruntime")) {
        break;
      }
      if (!first.includes(":")) {
        continue;
      }

      const durationLabel = first.replace(/:/g, "").trim();
      let durationMin;
      try {
        durationMin = parseDurationToMinutes(durationLabel);
      } catch (error) {
        continue;
      }

      if (durationMin > CONSTANTS.MAX_ATLAS_DURATION_MIN + 1e-9) {
        continue;
      }

      const values = row.slice(1).map(cleanCell);
      if (values.length < returnPeriods.length) {
        throw new Error(`Duration row '${durationLabel}' has fewer depth values than the ARI header.`);
      }

      durationLabels.push(durationLabel);
      returnPeriods.forEach((ari, index) => {
        const raw = values[index];
        if (!raw) {
          return;
        }
        const depth = Number(raw);
        if (!Number.isFinite(depth)) {
          throw new Error(`Could not parse depth '${raw}' for ${durationLabel}, ${ari}-year.`);
        }
        depthTable.push({
          duration: durationLabel,
          durationMin,
          durationHr: durationMin / 60,
          ariYr: ari,
          depthIn: depth,
          intensityInHr: intensityFromDepth(depth, durationMin)
        });
      });
    }

    if (!depthTable.length) {
      throw new Error("No precipitation frequency estimate rows through 2 days were parsed from the CSV.");
    }

    depthTable.sort((a, b) => (a.durationMin - b.durationMin) || (a.ariYr - b.ariYr));
    const atlas = { metadata, depthTable, returnPeriods, durationLabels };
    validateMonotonicAtlas(atlas);

    CONSTANTS.MANUAL_DEPTH_DURATIONS_MIN.forEach((durationMin) => {
      getDepth(atlas, CONSTANTS.REFERENCE_ARI_YR, durationMin);
    });

    return atlas;
  }

  function validateMonotonicAtlas(atlas) {
    atlas.returnPeriods.forEach((ari) => {
      const part = atlas.depthTable
        .filter((row) => almostEqual(row.ariYr, ari))
        .sort((a, b) => a.durationMin - b.durationMin);
      for (let i = 1; i < part.length; i += 1) {
        if (part[i].durationMin - part[i - 1].durationMin <= 0) {
          throw new Error("Atlas durations must be strictly increasing for each return period.");
        }
        if (part[i].depthIn - part[i - 1].depthIn < -1e-9) {
          throw new Error(`Atlas depths should not decrease with duration for the ${ari}-year series.`);
        }
      }
    });

    const durations = [...new Set(atlas.depthTable.map((row) => row.durationMin))].sort((a, b) => a - b);
    durations.forEach((durationMin) => {
      const part = atlas.depthTable
        .filter((row) => almostEqual(row.durationMin, durationMin))
        .sort((a, b) => a.ariYr - b.ariYr);
      for (let i = 1; i < part.length; i += 1) {
        if (part[i].depthIn - part[i - 1].depthIn < -1e-9) {
          throw new Error(`Atlas depths should not decrease with recurrence interval for ${formatDuration(durationMin)}.`);
        }
      }
    });
  }

  function getDepth(atlas, ariYr, durationMin) {
    const row = atlas.depthTable.find(
      (item) => almostEqual(item.ariYr, ariYr) && almostEqual(item.durationMin, durationMin)
    );
    if (!row) {
      throw new Error(`Atlas table does not contain ${ariYr}-year, ${formatDuration(durationMin)} depth.`);
    }
    return row.depthIn;
  }

  function interpolate1d(x, xp, fp) {
    if (!xp.length || xp.length !== fp.length) {
      throw new Error("Interpolation arrays are empty or inconsistent.");
    }
    if (x <= xp[0]) {
      return fp[0];
    }
    const last = xp.length - 1;
    if (x >= xp[last]) {
      return fp[last];
    }
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (xp[middle] <= x) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const fraction = (x - xp[low]) / (xp[high] - xp[low]);
    return fp[low] + fraction * (fp[high] - fp[low]);
  }

  function fractionalDistributionStorm(distribution, totalDepthIn) {
    const nSteps = Math.round(CONSTANTS.STORM_DURATION_MIN / CONSTANTS.TIMESTEP_MIN);
    const timeEdges = Array.from({ length: nSteps + 1 }, (_, index) => index * CONSTANTS.TIMESTEP_MIN);
    const fractionTime = timeEdges.map((value) => value / CONSTANTS.STORM_DURATION_MIN);
    let cumulativeFraction = fractionTime.map((value) => interpolate1d(
      value,
      distribution.fractionTime,
      distribution.fractionCumulativeDepth
    ));
    cumulativeFraction = cumulativeMaximum(cumulativeFraction.map((value) => Math.min(1, Math.max(0, value))));
    cumulativeFraction[0] = 0;
    cumulativeFraction[cumulativeFraction.length - 1] = 1;

    const cumulativeDepth = cumulativeFraction.map((value) => value * totalDepthIn);
    let incrementalDepthIn = [];
    for (let i = 1; i < cumulativeDepth.length; i += 1) {
      incrementalDepthIn.push(Math.max(0, cumulativeDepth[i] - cumulativeDepth[i - 1]));
    }

    const total = arraySum(incrementalDepthIn);
    if (total > 0) {
      incrementalDepthIn = incrementalDepthIn.map((value) => value * totalDepthIn / total);
    }

    return buildStorm(distribution.name, totalDepthIn, timeEdges, incrementalDepthIn);
  }

  function logLogInterpolatedDepths(atlas, ariYr, targetDurationsMin, totalDepthIn) {
    const part = atlas.depthTable
      .filter((row) => almostEqual(row.ariYr, ariYr) && row.durationMin <= CONSTANTS.STORM_DURATION_MIN + 1e-9)
      .sort((a, b) => a.durationMin - b.durationMin);

    if (part.length < 2) {
      throw new Error("At least two Atlas durations are required for alternating block interpolation.");
    }

    const atlas24HourDepth = getDepth(atlas, ariYr, CONSTANTS.STORM_DURATION_MIN);
    const scaleFactor = totalDepthIn / Math.max(atlas24HourDepth, 1e-12);
    const knownDuration = part.map((row) => row.durationMin);
    const knownDepth = part.map((row) => row.depthIn * scaleFactor);
    const logDuration = knownDuration.map(Math.log);
    const logDepth = knownDepth.map(Math.log);
    const minDuration = knownDuration[0];

    const depths = targetDurationsMin.map((durationMin) => {
      if (durationMin <= 0) {
        return 0;
      }
      return Math.exp(interpolate1d(Math.log(Math.max(durationMin, minDuration)), logDuration, logDepth));
    });
    return cumulativeMaximum(depths);
  }

  function alternatingBlockStorm(atlas, totalDepthIn, centerFraction) {
    const nSteps = Math.round(CONSTANTS.STORM_DURATION_MIN / CONSTANTS.TIMESTEP_MIN);
    const blockDurations = Array.from({ length: nSteps }, (_, index) => (index + 1) * CONSTANTS.TIMESTEP_MIN);
    const cumulativeDepths = logLogInterpolatedDepths(
      atlas,
      CONSTANTS.REFERENCE_ARI_YR,
      blockDurations,
      totalDepthIn
    );
    cumulativeDepths[cumulativeDepths.length - 1] = totalDepthIn;

    const incrementalByRank = [];
    let previous = 0;
    cumulativeDepths.forEach((value) => {
      incrementalByRank.push(Math.max(0, value - previous));
      previous = value;
    });

    const sortedBlocks = [...incrementalByRank].sort((a, b) => b - a);
    const centerIndex = Math.round(centerFraction * (nSteps - 1));
    const positions = [centerIndex];
    for (let offset = 1; positions.length < nSteps; offset += 1) {
      const right = centerIndex + offset;
      const left = centerIndex - offset;
      if (right < nSteps) {
        positions.push(right);
      }
      if (left >= 0) {
        positions.push(left);
      }
    }

    let incrementalDepthIn = Array(nSteps).fill(0);
    sortedBlocks.forEach((block, index) => {
      incrementalDepthIn[positions[index]] = block;
    });
    const total = arraySum(incrementalDepthIn);
    if (total > 0) {
      incrementalDepthIn = incrementalDepthIn.map((value) => value * totalDepthIn / total);
    }

    const timeEdges = Array.from({ length: nSteps + 1 }, (_, index) => index * CONSTANTS.TIMESTEP_MIN);
    return buildStorm(
      `Alternating Block (${Math.round(centerFraction * 100)}% centered)`,
      totalDepthIn,
      timeEdges,
      incrementalDepthIn
    );
  }

  function buildStorm(method, totalDepthIn, timeEdges, incrementalDepthIn) {
    let cumulative = 0;
    const cumulativeDepthIn = incrementalDepthIn.map((value) => {
      cumulative += value;
      return cumulative;
    });
    return {
      method,
      timestepMin: CONSTANTS.TIMESTEP_MIN,
      totalDepthIn,
      timeStartMin: timeEdges.slice(0, -1),
      timeEndMin: timeEdges.slice(1),
      timeMidMin: timeEdges.slice(0, -1).map((value, index) => 0.5 * (value + timeEdges[index + 1])),
      incrementalDepthIn,
      cumulativeDepthIn
    };
  }

  function generateStorm(atlas, method, applied24HourDepthIn, library) {
    if (String(method).startsWith("dist::")) {
      const key = String(method).split("::", 2)[1];
      if (!library[key]) {
        throw new Error(`Temporal distribution '${key}' was not found in the loaded distribution library.`);
      }
      return fractionalDistributionStorm(library[key], applied24HourDepthIn);
    }
    if (String(method).startsWith("abm_")) {
      const percent = Number(String(method).split("_", 2)[1]);
      return alternatingBlockStorm(atlas, applied24HourDepthIn, percent / 100);
    }
    throw new Error(`Unsupported temporal distribution method: ${method}`);
  }

  function rollingMaximumDepth(rainfall, window) {
    const size = Math.max(1, Math.round(window));
    const padded = [...rainfall];
    while (padded.length < size) {
      padded.push(0);
    }
    let sum = 0;
    for (let i = 0; i < size; i += 1) {
      sum += padded[i];
    }
    let best = sum;
    for (let i = size; i < padded.length; i += 1) {
      sum += padded[i] - padded[i - size];
      best = Math.max(best, sum);
    }
    return best;
  }

  function computeGeneratedIdf(storm, atlas) {
    const durations = [...new Set(atlas.depthTable
      .map((row) => row.durationMin)
      .filter((duration) => duration <= CONSTANTS.MAX_ATLAS_DURATION_MIN + 1e-9))]
      .sort((a, b) => a - b);

    return durations.map((durationMin) => {
      const window = Math.max(1, Math.round(durationMin / storm.timestepMin));
      const maxDepth = rollingMaximumDepth(storm.incrementalDepthIn, window);
      return {
        duration: formatDuration(durationMin),
        durationMin,
        generatedMaxDepthIn: maxDepth,
        generatedIntensityInHr: intensityFromDepth(maxDepth, durationMin)
      };
    });
  }

  function makeDepthCheckTable(atlas, generatedIdf, manualDepths) {
    const atlas100 = atlas.depthTable
      .filter((row) => almostEqual(row.ariYr, CONSTANTS.REFERENCE_ARI_YR) && row.durationMin <= CONSTANTS.MAX_ATLAS_DURATION_MIN + 1e-9)
      .sort((a, b) => a.durationMin - b.durationMin);
    const generatedByDuration = new Map(generatedIdf.map((row) => [row.durationMin, row]));

    return atlas100.map((atlasRow) => {
      const durationMin = atlasRow.durationMin;
      const entered = safeNumber(manualDepths[durationMin], null);
      const required = CONSTANTS.MANUAL_DEPTH_DURATIONS_MIN.some((duration) => almostEqual(duration, durationMin));
      const manualDifference = entered === null ? null : entered - atlasRow.depthIn;
      let manualCheck = "Not requested";
      if (entered === null && required) {
        manualCheck = "Missing";
      } else if (entered !== null) {
        manualCheck = Math.abs(manualDifference) <= CONSTANTS.DEPTH_TOL_IN ? "Pass" : "Check";
      }

      const processed = generatedByDuration.get(durationMin);
      const processedDepth = processed ? processed.generatedMaxDepthIn : null;
      const processedIntensity = processed ? processed.generatedIntensityInHr : null;

      return {
        duration: formatDuration(durationMin),
        enteredAtlasDepthIn: entered === null ? null : roundNumber(entered, 3),
        atlas100DepthIn: roundNumber(atlasRow.depthIn, 3),
        manualDifferenceIn: manualDifference === null ? null : roundNumber(manualDifference, 3),
        manualCheck,
        processedStormMaxDepthIn: processedDepth === null ? null : roundNumber(processedDepth, 3),
        processedMinusAtlasDepthIn: processedDepth === null ? null : roundNumber(processedDepth - atlasRow.depthIn, 3),
        processedStormIntensityInHr: processedIntensity === null ? null : roundNumber(processedIntensity, 3),
        atlas100IntensityInHr: roundNumber(atlasRow.intensityInHr, 3),
        processedMinusAtlasIntensityInHr: processedIntensity === null ? null : roundNumber(processedIntensity - atlasRow.intensityInHr, 3)
      };
    });
  }

  function metadataLocationText(atlas) {
    const location = atlas.metadata["Location name (ESRI Maps)"] || "Unknown location";
    const latitude = atlas.metadata.Latitude || "";
    const longitude = atlas.metadata.Longitude || "";
    return latitude && longitude ? `${location} | Lat ${latitude}, Lon ${longitude}` : location;
  }

  global.PrecipModel = Object.freeze({
    CONSTANTS,
    SAMPLE_ATLAS14_CSV,
    cleanCell,
    normalizeHeader,
    safeNumber,
    roundNumber,
    argMax,
    parseCsvRows,
    parseDistributionCsvText,
    loadDistributionLibrary,
    distributionDropdownOptions,
    parseDurationToMinutes,
    formatDuration,
    intensityFromDepth,
    parseAtlas14CsvText,
    validateMonotonicAtlas,
    getDepth,
    interpolate1d,
    fractionalDistributionStorm,
    alternatingBlockStorm,
    generateStorm,
    computeGeneratedIdf,
    makeDepthCheckTable,
    metadataLocationText
  });
})(window);
