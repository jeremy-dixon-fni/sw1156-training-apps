"""
Atlas 14 Temporal Distribution Trainer - Larger IDF Plot

Learning objective:
Show that Atlas 14 depth-duration-frequency data and temporal-distribution choices answer
related but different questions: the IDF table defines reference rainfall depths by duration,
while a selected hyetograph method distributes a 24-hour design rainfall through time.

Run:
    python Atlas14TemporalDistributionTrainer_fractional_v6_larger_idf.py

Dependencies:
    dash pandas numpy plotly

Notes:
    - This app expects a NOAA Atlas 14 PDS depth CSV with the row:
      "by duration for ARI (years):, 1,2,5,10,25,50,100,..."
    - Temporal-distribution library files use fractional time and fractional cumulative depth.
    - The generated storm uses a fixed 5-minute timestep and a 24-hour duration.
    - NumPy's deprecated np.trapz is not used.
"""

from __future__ import annotations

import base64
import csv
import io
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, dcc, html, dash_table


# -----------------------------
# Constants and brand colors
# -----------------------------

FNI_BLUE = "#015D91"
FNI_GREEN = "#A9C945"
FNI_NAVY = "#093D5E"
FNI_AQUA = "#45A6DD"
FNI_TURQUOISE = "#5BC1CF"
FNI_YELLOW = "#DEB326"
FNI_ORANGE = "#E05126"
FNI_NEUTRAL_BLUE = "#93AFB4"
FNI_DARK_GRAY = "#4D4D4F"
FNI_GRAY = "#B1B1B1"

TIMESTEP_MIN = 5.0
STORM_DURATION_HR = 24.0
STORM_DURATION_MIN = STORM_DURATION_HR * 60.0
MAX_ATLAS_DURATION_MIN = 2.0 * 24.0 * 60.0
REFERENCE_ARI_YR = 100.0
MANUAL_DEPTH_DURATIONS_MIN = [5.0, 15.0, 60.0, 120.0, 180.0, 360.0, 720.0, STORM_DURATION_MIN]

DEPTH_TOL_IN = 0.01
INTENSITY_TOL_INHR = 0.05

CARD_STYLE = {
    "backgroundColor": "white",
    "border": "1px solid #d9e2e8",
    "borderRadius": "16px",
    "padding": "16px",
    "boxShadow": "0 4px 12px rgba(9, 61, 94, 0.08)",
}

METRIC_CARD_STYLE = {
    **CARD_STYLE,
    "minHeight": "112px",
}

UPLOAD_STYLE = {
    "width": "100%",
    "height": "70px",
    "lineHeight": "70px",
    "borderWidth": "1px",
    "borderStyle": "dashed",
    "borderRadius": "12px",
    "textAlign": "center",
    "borderColor": FNI_NEUTRAL_BLUE,
    "backgroundColor": "#f8fbfc",
    "color": FNI_NAVY,
}

CONTROL_LABEL_STYLE = {
    "fontWeight": "bold",
    "display": "block",
    "marginTop": "14px",
    "marginBottom": "6px",
}

SMALL_TEXT_STYLE = {"fontSize": "13px", "color": FNI_DARK_GRAY}

ATLAS_LINE_COLORS = [
    "#00b050",  # 1-year
    "#ff9900",  # 2-year
    "#ff6600",  # 5-year
    "#ff0000",  # 10-year
    "#ff00ff",  # 25-year
    "#8000ff",  # 50-year
    "#0000ff",  # 100-year
    "#00a6ff",  # 200-year
    "#00cfd4",  # 500-year
    "#333333",  # 1000-year
]


# Embedded sample file used only when no CSV has been uploaded. This keeps the prototype
# immediately visible while preserving the upload workflow.
SAMPLE_ATLAS14_CSV = """Point precipitation frequency estimates (inches)
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
"""


# Built-in fallback fractional temporal-distribution CSVs.
# External CSVs placed in a sibling folder named "temporal_distributions" are loaded
# at startup and override these by filename stem. The built-ins are approximate legacy
# SCS-style curves retained only so the single-file prototype still runs by itself.
BUILTIN_DISTRIBUTION_CSVS: Dict[str, str] = {
    "SCS-type-ii.csv": """# distribution_name: SCS Type II - approximate legacy
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
""",
    "SCS-type-iii.csv": """# distribution_name: SCS Type III - approximate legacy
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
""",
}

DISTRIBUTION_DIR = Path(__file__).with_name("temporal_distributions")


# -----------------------------
# Data classes
# -----------------------------

@dataclass
class AtlasData:
    metadata: Dict[str, str]
    depth_table: pd.DataFrame
    return_periods: np.ndarray
    duration_labels: List[str]


@dataclass
class GeneratedStorm:
    method: str
    timestep_min: float
    total_depth_in: float
    time_start_min: np.ndarray
    time_end_min: np.ndarray
    time_mid_min: np.ndarray
    incremental_depth_in: np.ndarray
    cumulative_depth_in: np.ndarray


@dataclass
class TemporalDistribution:
    key: str
    name: str
    source: str
    fraction_time: np.ndarray
    fraction_cumulative_depth: np.ndarray


# -----------------------------
# Helper utilities
# -----------------------------

def clean_cell(value: str) -> str:
    return str(value).strip().strip('\ufeff')


def parse_uploaded_text(contents: str | None, fallback_text: str) -> Tuple[str, bool]:
    """Return decoded upload text and a flag indicating whether sample text was used."""
    if contents is None:
        return fallback_text, True
    try:
        _, content_string = contents.split(",", 1)
        decoded = base64.b64decode(content_string)
        return decoded.decode("utf-8-sig"), False
    except Exception as exc:
        raise ValueError(f"Could not decode uploaded CSV: {exc}") from exc


def parse_duration_to_minutes(label: str) -> float:
    """Convert Atlas duration labels such as 5-min, 60-min, 2-hr, or multi-day values to minutes."""
    text = clean_cell(label).lower().replace(":", "")
    match = re.match(r"^([0-9]*\.?[0-9]+)\s*-?\s*(min|minute|minutes|hr|hour|hours|day|days)$", text)
    if not match:
        raise ValueError(f"Unsupported duration label: {label}")
    value = float(match.group(1))
    unit = match.group(2)
    if unit.startswith("min"):
        return value
    if unit in {"hr", "hour", "hours"}:
        return value * 60.0
    if unit.startswith("day"):
        return value * 24.0 * 60.0
    raise ValueError(f"Unsupported duration unit in label: {label}")


def format_duration(minutes: float) -> str:
    if abs(minutes - 60.0) < 1e-9:
        return "60-min"
    if minutes < 60.0:
        return f"{int(round(minutes))}-min"
    if minutes <= 24.0 * 60.0:
        hours = minutes / 60.0
        return f"{int(round(hours))}-hr"
    days = minutes / (24.0 * 60.0)
    return f"{int(round(days))}-day"


def safe_numeric(value, fallback=None):
    if value is None or value == "":
        return fallback
    try:
        out = float(value)
        return out if np.isfinite(out) else fallback
    except Exception:
        return fallback


def normalize_header(name: str) -> str:
    text = str(name).strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def extract_distribution_metadata(text: str) -> Dict[str, str]:
    metadata: Dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip().lstrip("\ufeff")
        # Excel may preserve quotes around comment-style metadata rows. Treat
        # quoted # rows as metadata too, and remove trailing CSV delimiter noise.
        line = line.strip('"').strip()
        if line.endswith(","):
            line = line[:-1].strip()
        if not line.startswith("#"):
            continue
        content = line[1:].strip()
        if ":" in content:
            key, value = content.split(":", 1)
            metadata[normalize_header(key)] = value.strip().strip('"').rstrip(",").strip()
    return metadata


def parse_distribution_csv_text(text: str, source: str, fallback_name: str | None = None) -> TemporalDistribution:
    """Parse a dimensionless cumulative temporal distribution CSV.

    Required data columns, with flexible naming:
    - fraction_time
    - fraction_cumulative_depth

    Metadata may be supplied in comment lines, for example:
    # distribution_name: NOAA14 TX 2-1Q90
    """
    metadata = extract_distribution_metadata(text)
    try:
        raw = pd.read_csv(io.StringIO(text), comment="#")
    except Exception as exc:
        raise ValueError(f"Could not read temporal distribution CSV '{source}': {exc}") from exc

    if raw.empty:
        raise ValueError(f"Temporal distribution CSV '{source}' has no data rows.")

    normalized = {normalize_header(col): col for col in raw.columns}
    time_candidates = [
        "fraction_time",
        "time_fraction",
        "t_fraction",
        "fractional_time",
        "normalized_time",
        "dimensionless_time",
    ]
    depth_candidates = [
        "fraction_cumulative_depth",
        "cumulative_depth_fraction",
        "cum_depth_fraction",
        "depth_fraction",
        "fraction_depth",
        "fractional_cumulative_depth",
        "normalized_cumulative_depth",
        "dimensionless_cumulative_depth",
    ]

    time_col = next((normalized[c] for c in time_candidates if c in normalized), None)
    depth_col = next((normalized[c] for c in depth_candidates if c in normalized), None)
    if time_col is None or depth_col is None:
        raise ValueError(
            f"Temporal distribution CSV '{source}' must contain columns named "
            "fraction_time and fraction_cumulative_depth. Flexible aliases are accepted, "
            "but both time and cumulative-depth fractions are required."
        )

    df = raw[[time_col, depth_col]].copy()
    df.columns = ["fraction_time", "fraction_cumulative_depth"]
    df["fraction_time"] = pd.to_numeric(df["fraction_time"], errors="coerce")
    df["fraction_cumulative_depth"] = pd.to_numeric(df["fraction_cumulative_depth"], errors="coerce")
    df = df.dropna().sort_values("fraction_time").reset_index(drop=True)

    if len(df) < 2:
        raise ValueError(f"Temporal distribution CSV '{source}' must contain at least two valid rows.")

    ft = df["fraction_time"].to_numpy(dtype=float)
    fd = df["fraction_cumulative_depth"].to_numpy(dtype=float)

    if np.any(ft < -1e-9) or np.any(ft > 1.0 + 1e-9):
        raise ValueError(f"Temporal distribution CSV '{source}' has fraction_time values outside 0 to 1.")
    if np.any(fd < -1e-9) or np.any(fd > 1.0 + 1e-9):
        raise ValueError(f"Temporal distribution CSV '{source}' has cumulative-depth fractions outside 0 to 1.")
    if np.any(np.diff(ft) <= 0.0):
        raise ValueError(f"Temporal distribution CSV '{source}' fraction_time values must be strictly increasing.")
    if np.any(np.diff(fd) < -1e-9):
        raise ValueError(f"Temporal distribution CSV '{source}' cumulative-depth fractions must be nondecreasing.")

    # Snap tiny floating-point deviations to the intended endpoints. Missing endpoints are
    # inserted because many published distributions start with the first nonzero ordinate.
    ft = np.clip(ft, 0.0, 1.0)
    fd = np.clip(fd, 0.0, 1.0)
    if ft[0] > 1e-9:
        ft = np.insert(ft, 0, 0.0)
        fd = np.insert(fd, 0, 0.0)
    elif abs(fd[0]) > 1e-6:
        raise ValueError(f"Temporal distribution CSV '{source}' must start with cumulative depth fraction 0 at time fraction 0.")
    else:
        ft[0] = 0.0
        fd[0] = 0.0

    if ft[-1] < 1.0 - 1e-9:
        ft = np.append(ft, 1.0)
        fd = np.append(fd, 1.0)
    elif abs(fd[-1] - 1.0) > 1e-6:
        raise ValueError(f"Temporal distribution CSV '{source}' must end with cumulative depth fraction 1 at time fraction 1.")
    else:
        ft[-1] = 1.0
        fd[-1] = 1.0

    if source.startswith("embedded:"):
        source_stem = Path(source.split(":", 1)[1]).stem
    else:
        source_stem = Path(source).stem
    # For library CSV files, use the filename as the user-facing temporal distribution
    # name. This avoids repeated dropdown labels when several NOAA files share similar
    # metadata. Embedded fallback files can still use their metadata labels.
    if source.startswith("embedded:"):
        name = metadata.get("distribution_name") or metadata.get("name") or fallback_name or source_stem
    else:
        name = fallback_name or source_stem
    key = normalize_header(source_stem or name)
    return TemporalDistribution(
        key=key,
        name=name,
        source=source,
        fraction_time=ft,
        fraction_cumulative_depth=np.maximum.accumulate(fd),
    )


def load_distribution_library() -> Dict[str, TemporalDistribution]:
    """Load temporal distributions from temporal_distributions/*.csv plus built-in fallback CSVs."""
    library: Dict[str, TemporalDistribution] = {}

    # Start with built-in fallbacks so the app runs even when only the .py file is present.
    for filename, text in BUILTIN_DISTRIBUTION_CSVS.items():
        dist = parse_distribution_csv_text(text, source=f"embedded:{filename}", fallback_name=Path(filename).stem)
        library[dist.key] = dist

    # Then allow real project CSV files to override or add to the library.
    if DISTRIBUTION_DIR.exists():
        for csv_path in sorted(DISTRIBUTION_DIR.glob("*.csv")):
            dist = parse_distribution_csv_text(
                csv_path.read_text(encoding="utf-8-sig"),
                source=str(csv_path),
                fallback_name=csv_path.stem,
            )
            library[dist.key] = dist

    return library


def distribution_dropdown_options(library: Dict[str, TemporalDistribution]) -> List[Dict[str, str]]:
    options = [
        {"label": dist.name, "value": f"dist::{key}"}
        for key, dist in sorted(library.items(), key=lambda item: item[1].name.lower())
    ]
    options.extend(
        [
            {"label": "Alternating Block - 25% centered", "value": "abm_25"},
            {"label": "Alternating Block - 33% centered", "value": "abm_33"},
            {"label": "Alternating Block - 50% centered", "value": "abm_50"},
            {"label": "Alternating Block - 67% centered", "value": "abm_67"},
            {"label": "Alternating Block - 75% centered", "value": "abm_75"},
        ]
    )
    return options


DISTRIBUTION_LIBRARY = load_distribution_library()
DEFAULT_DISTRIBUTION_KEY = "scs_type_ii" if "scs_type_ii" in DISTRIBUTION_LIBRARY else next(iter(DISTRIBUTION_LIBRARY))
DEFAULT_DISTRIBUTION_VALUE = f"dist::{DEFAULT_DISTRIBUTION_KEY}"


def get_depth(atlas: AtlasData, ari_yr: float, duration_min: float) -> float:
    df = atlas.depth_table
    mask = (np.isclose(df["ARI (yr)"].to_numpy(dtype=float), float(ari_yr))) & (
        np.isclose(df["Duration (min)"].to_numpy(dtype=float), float(duration_min))
    )
    if not np.any(mask):
        raise ValueError(f"Atlas table does not contain {ari_yr:g}-year, {format_duration(duration_min)} depth.")
    return float(df.loc[mask, "Depth (in)"].iloc[0])


def intensity_from_depth(depth_in: float, duration_min: float) -> float:
    return float(depth_in) / (float(duration_min) / 60.0)


def validate_monotonic_atlas(atlas: AtlasData) -> None:
    df = atlas.depth_table
    for ari in atlas.return_periods:
        part = df[np.isclose(df["ARI (yr)"], ari)].sort_values("Duration (min)")
        if np.any(np.diff(part["Duration (min)"].to_numpy(dtype=float)) <= 0.0):
            raise ValueError("Atlas durations must be strictly increasing for each return period.")
        if np.any(np.diff(part["Depth (in)"].to_numpy(dtype=float)) < -1e-9):
            raise ValueError(f"Atlas depths should not decrease with duration for the {ari:g}-year series.")

    for duration in sorted(df["Duration (min)"].unique()):
        part = df[np.isclose(df["Duration (min)"], duration)].sort_values("ARI (yr)")
        if np.any(np.diff(part["Depth (in)"].to_numpy(dtype=float)) < -1e-9):
            raise ValueError(f"Atlas depths should not decrease with recurrence interval for {format_duration(duration)}.")


# -----------------------------
# Data loading and validation
# -----------------------------

def parse_atlas14_csv_text(text: str) -> AtlasData:
    rows = list(csv.reader(io.StringIO(text)))
    metadata: Dict[str, str] = {}

    for row in rows:
        if not row:
            continue
        first = clean_cell(row[0])
        if ":" in first and not first.lower().startswith("by duration for ari"):
            key, value = first.split(":", 1)
            if value.strip():
                metadata[key.strip()] = value.strip()
            elif len(row) > 1:
                metadata[key.strip()] = clean_cell(row[1])

    header_idx = None
    for i, row in enumerate(rows):
        if row and clean_cell(row[0]).lower().startswith("by duration for ari"):
            header_idx = i
            break

    if header_idx is None:
        raise ValueError("Could not find the Atlas 14 ARI header row: 'by duration for ARI (years):'.")

    header = rows[header_idx]
    try:
        return_periods = np.asarray([float(clean_cell(cell)) for cell in header[1:] if clean_cell(cell)], dtype=float)
    except Exception as exc:
        raise ValueError("Could not parse Atlas 14 ARI values from the header row.") from exc

    if len(return_periods) == 0:
        raise ValueError("No return periods were found in the Atlas 14 CSV.")

    records: List[Dict[str, float | str]] = []
    duration_labels: List[str] = []

    for row in rows[header_idx + 1 :]:
        if not row or not clean_cell(row[0]):
            continue
        first = clean_cell(row[0])
        if first.lower().startswith("date/time") or first.lower().startswith("pyruntime"):
            break
        if ":" not in first:
            continue

        duration_label = first.replace(":", "").strip()
        try:
            duration_min = parse_duration_to_minutes(duration_label)
        except ValueError:
            continue

        # Keep the trainer focused on short-duration through 2-day Atlas 14 data.
        # Longer-duration Atlas rows are intentionally excluded from parsing, plots,
        # and rolling-maximum diagnostics.
        if duration_min > MAX_ATLAS_DURATION_MIN + 1e-9:
            continue

        values = [clean_cell(cell) for cell in row[1:]]
        if len(values) < len(return_periods):
            raise ValueError(f"Duration row '{duration_label}' has fewer depth values than the ARI header.")

        duration_labels.append(duration_label)
        for ari, value in zip(return_periods, values):
            if not value:
                continue
            depth = float(value)
            records.append(
                {
                    "Duration": duration_label,
                    "Duration (min)": duration_min,
                    "Duration (hr)": duration_min / 60.0,
                    "ARI (yr)": float(ari),
                    "Depth (in)": depth,
                    "Intensity (in/hr)": intensity_from_depth(depth, duration_min),
                }
            )

    if not records:
        raise ValueError("No precipitation frequency estimate rows through 2 days were parsed from the CSV.")

    table = pd.DataFrame.from_records(records)
    table = table.sort_values(["Duration (min)", "ARI (yr)"]).reset_index(drop=True)
    atlas = AtlasData(
        metadata=metadata,
        depth_table=table,
        return_periods=return_periods,
        duration_labels=duration_labels,
    )
    validate_monotonic_atlas(atlas)

    required = [(REFERENCE_ARI_YR, duration_min) for duration_min in MANUAL_DEPTH_DURATIONS_MIN]
    for ari, dur in required:
        _ = get_depth(atlas, ari, dur)

    return atlas


# -----------------------------
# Model computation
# -----------------------------

def fractional_distribution_storm(distribution: TemporalDistribution, total_depth_in: float) -> GeneratedStorm:
    """Scale a dimensionless cumulative distribution to a 24-hour design storm."""
    n_steps = int(round(STORM_DURATION_MIN / TIMESTEP_MIN))
    time_edges = np.arange(n_steps + 1, dtype=float) * TIMESTEP_MIN
    fraction_time = time_edges / STORM_DURATION_MIN
    cumulative_fraction = np.interp(
        fraction_time,
        distribution.fraction_time,
        distribution.fraction_cumulative_depth,
    )
    cumulative_fraction = np.maximum.accumulate(np.clip(cumulative_fraction, 0.0, 1.0))
    cumulative_fraction[0] = 0.0
    cumulative_fraction[-1] = 1.0

    cumulative_depth = cumulative_fraction * float(total_depth_in)
    incremental = np.diff(cumulative_depth)
    incremental = np.maximum(incremental, 0.0)

    # Re-normalize after nonnegative clipping to preserve the requested 24-hour depth.
    if incremental.sum() > 0.0:
        incremental *= float(total_depth_in) / incremental.sum()
    cumulative_after_blocks = np.cumsum(incremental)

    return GeneratedStorm(
        method=distribution.name,
        timestep_min=TIMESTEP_MIN,
        total_depth_in=float(total_depth_in),
        time_start_min=time_edges[:-1],
        time_end_min=time_edges[1:],
        time_mid_min=0.5 * (time_edges[:-1] + time_edges[1:]),
        incremental_depth_in=incremental,
        cumulative_depth_in=cumulative_after_blocks,
    )


def parse_uploaded_distribution(contents: str | None, filename: str | None) -> TemporalDistribution:
    if contents is None:
        raise ValueError("Select a temporal distribution CSV or choose a library distribution.")
    text, _ = parse_uploaded_text(contents, fallback_text="")
    return parse_distribution_csv_text(
        text,
        source=filename or "uploaded temporal distribution CSV",
        fallback_name=Path(filename or "uploaded-distribution").stem,
    )


def loglog_interpolated_depths(
    atlas: AtlasData,
    ari_yr: float,
    target_durations_min: np.ndarray,
    total_depth_in: float,
) -> np.ndarray:
    part = atlas.depth_table[
        (np.isclose(atlas.depth_table["ARI (yr)"], float(ari_yr)))
        & (atlas.depth_table["Duration (min)"] <= STORM_DURATION_MIN + 1e-9)
    ].sort_values("Duration (min)")

    known_duration = part["Duration (min)"].to_numpy(dtype=float)
    known_depth = part["Depth (in)"].to_numpy(dtype=float)
    if len(known_duration) < 2:
        raise ValueError("At least two Atlas durations are required for alternating block interpolation.")

    atlas_24hr_depth = get_depth(atlas, ari_yr, STORM_DURATION_MIN)
    scale_factor = float(total_depth_in) / max(atlas_24hr_depth, 1e-12)
    known_depth = known_depth * scale_factor

    min_duration = float(known_duration.min())
    adjusted_target = np.maximum(target_durations_min, min_duration)
    log_depth = np.interp(np.log(adjusted_target), np.log(known_duration), np.log(known_depth))
    depths = np.exp(log_depth)

    # Preserve zero at zero duration outside log interpolation.
    depths[target_durations_min <= 0.0] = 0.0
    return np.maximum.accumulate(depths)


def alternating_block_storm(atlas: AtlasData, total_depth_in: float, center_fraction: float) -> GeneratedStorm:
    n_steps = int(round(STORM_DURATION_MIN / TIMESTEP_MIN))
    block_duration = np.arange(1, n_steps + 1, dtype=float) * TIMESTEP_MIN
    cumulative_depths = loglog_interpolated_depths(atlas, REFERENCE_ARI_YR, block_duration, total_depth_in)
    cumulative_depths[-1] = float(total_depth_in)
    incremental_by_rank = np.diff(np.insert(cumulative_depths, 0, 0.0))
    incremental_by_rank = np.maximum(incremental_by_rank, 0.0)

    # Largest incremental depth is placed at the selected center. Remaining depths alternate
    # after and before that center. This is the standard alternating-block teaching pattern.
    sorted_blocks = np.sort(incremental_by_rank)[::-1]
    center_idx = int(round(float(center_fraction) * (n_steps - 1)))
    positions: List[int] = [center_idx]
    for offset in range(1, n_steps + 1):
        right = center_idx + offset
        left = center_idx - offset
        if right < n_steps:
            positions.append(right)
        if left >= 0:
            positions.append(left)
        if len(positions) >= n_steps:
            break

    incremental = np.zeros(n_steps, dtype=float)
    for block, pos in zip(sorted_blocks, positions):
        incremental[pos] = block

    if incremental.sum() > 0.0:
        incremental *= float(total_depth_in) / incremental.sum()

    time_edges = np.arange(n_steps + 1, dtype=float) * TIMESTEP_MIN
    return GeneratedStorm(
        method=f"Alternating Block ({int(round(center_fraction * 100))}% centered)",
        timestep_min=TIMESTEP_MIN,
        total_depth_in=float(total_depth_in),
        time_start_min=time_edges[:-1],
        time_end_min=time_edges[1:],
        time_mid_min=0.5 * (time_edges[:-1] + time_edges[1:]),
        incremental_depth_in=incremental,
        cumulative_depth_in=np.cumsum(incremental),
    )


def generate_storm(
    atlas: AtlasData,
    method: str,
    applied_24hr_depth_in: float,
) -> GeneratedStorm:
    if method.startswith("dist::"):
        key = method.split("::", 1)[1]
        if key not in DISTRIBUTION_LIBRARY:
            raise ValueError(f"Temporal distribution '{key}' was not found in the loaded distribution library.")
        return fractional_distribution_storm(DISTRIBUTION_LIBRARY[key], applied_24hr_depth_in)


    if method.startswith("abm_"):
        center_percent = float(method.split("_", 1)[1])
        return alternating_block_storm(atlas, applied_24hr_depth_in, center_percent / 100.0)

    raise ValueError(f"Unsupported temporal distribution method: {method}")


def compute_generated_idf(storm: GeneratedStorm, atlas: AtlasData) -> pd.DataFrame:
    durations = sorted(
        d for d in atlas.depth_table["Duration (min)"].unique()
        if float(d) <= MAX_ATLAS_DURATION_MIN + 1e-9
    )
    rows: List[Dict[str, float | str]] = []
    dt = float(storm.timestep_min)
    rainfall = np.asarray(storm.incremental_depth_in, dtype=float)

    for duration_min in durations:
        window = int(round(float(duration_min) / dt))
        window = max(window, 1)
        padded = rainfall
        if len(padded) < window:
            padded = np.pad(padded, (0, window - len(padded)), mode="constant", constant_values=0.0)
        kernel = np.ones(window, dtype=float)
        rolling = np.convolve(padded, kernel, mode="valid")
        max_depth = float(rolling.max()) if len(rolling) else 0.0
        rows.append(
            {
                "Duration": format_duration(float(duration_min)),
                "Duration (min)": float(duration_min),
                "Generated Max Depth (in)": max_depth,
                "Generated Intensity (in/hr)": intensity_from_depth(max_depth, float(duration_min)),
            }
        )

    return pd.DataFrame(rows)


# -----------------------------
# Summary metrics
# -----------------------------

def make_depth_check_table(atlas: AtlasData, generated_idf: pd.DataFrame, manual_depths: Dict[float, object]) -> pd.DataFrame:
    """Combine manual Atlas 14 depth checks with processed-storm IDF diagnostics.

    Manual inputs are required for the durations in MANUAL_DEPTH_DURATIONS_MIN. Other Atlas
    durations through 2 days remain in the table so the processed storm can be compared at
    every parsed Atlas 14 duration.
    """
    atlas_100 = atlas.depth_table[
        np.isclose(atlas.depth_table["ARI (yr)"], REFERENCE_ARI_YR)
        & (atlas.depth_table["Duration (min)"] <= MAX_ATLAS_DURATION_MIN + 1e-9)
    ].copy()
    atlas_100 = atlas_100.sort_values("Duration (min)")
    generated_lookup = generated_idf.set_index("Duration (min)")

    rows = []
    for _, atlas_row in atlas_100.iterrows():
        duration_min = float(atlas_row["Duration (min)"])
        atlas_depth = float(atlas_row["Depth (in)"])
        atlas_intensity = float(atlas_row["Intensity (in/hr)"])
        entered_raw = manual_depths.get(duration_min, None)
        entered = safe_numeric(entered_raw, fallback=None)
        is_required = any(np.isclose(duration_min, required) for required in MANUAL_DEPTH_DURATIONS_MIN)

        if entered is None:
            manual_difference = None
            manual_status = "Missing" if is_required else "Not requested"
        else:
            manual_difference = float(entered) - atlas_depth
            manual_status = "Pass" if abs(manual_difference) <= DEPTH_TOL_IN else "Check"

        if duration_min in generated_lookup.index:
            gen_row = generated_lookup.loc[duration_min]
            # loc may return a DataFrame if duplicate durations somehow exist.
            if isinstance(gen_row, pd.DataFrame):
                gen_row = gen_row.iloc[0]
            processed_depth = float(gen_row["Generated Max Depth (in)"])
            processed_intensity = float(gen_row["Generated Intensity (in/hr)"])
        else:
            processed_depth = np.nan
            processed_intensity = np.nan

        rows.append(
            {
                "Duration": format_duration(duration_min),
                "Entered Atlas Depth (in)": None if entered is None else round(float(entered), 3),
                "Atlas 100-yr Depth (in)": round(atlas_depth, 3),
                "Manual Difference (in)": None if manual_difference is None else round(float(manual_difference), 3),
                "Manual Check": manual_status,
                "Processed Storm Max Depth (in)": None if not np.isfinite(processed_depth) else round(processed_depth, 3),
                "Processed - Atlas Depth (in)": None if not np.isfinite(processed_depth) else round(processed_depth - atlas_depth, 3),
                "Processed Storm Intensity (in/hr)": None if not np.isfinite(processed_intensity) else round(processed_intensity, 3),
                "Atlas 100-yr Intensity (in/hr)": round(atlas_intensity, 3),
                "Processed - Atlas Intensity (in/hr)": None if not np.isfinite(processed_intensity) else round(processed_intensity - atlas_intensity, 3),
            }
        )
    return pd.DataFrame(rows)

def metric_card(title: str, value: str, subtitle: str) -> html.Div:
    return html.Div(
        [
            html.Div(title, style={"fontSize": "14px", "fontWeight": "bold", "color": FNI_DARK_GRAY, "marginBottom": "8px"}),
            html.Div(value, style={"fontSize": "25px", "fontWeight": "bold", "color": FNI_BLUE, "marginBottom": "6px"}),
            html.Div(subtitle, style={"fontSize": "13px", "color": FNI_DARK_GRAY}),
        ]
    )


def metadata_location_text(atlas: AtlasData) -> str:
    location = atlas.metadata.get("Location name (ESRI Maps)", "Unknown location")
    lat = atlas.metadata.get("Latitude", "")
    lon = atlas.metadata.get("Longitude", "")
    parts = [location]
    if lat and lon:
        parts.append(f"Lat {lat}, Lon {lon}")
    return " | ".join(parts)


# -----------------------------
# Plotting
# -----------------------------

def empty_figure(title: str) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(
        title=title,
        template="plotly_white",
        margin={"l": 50, "r": 20, "t": 60, "b": 50},
    )
    return fig


def make_hyetograph_figure(storm: GeneratedStorm) -> go.Figure:
    intensity = storm.incremental_depth_in / (storm.timestep_min / 60.0)
    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=storm.time_mid_min / 60.0,
            y=storm.incremental_depth_in,
            name="Incremental rainfall depth",
            marker_color=FNI_BLUE,
            customdata=np.column_stack([intensity, storm.cumulative_depth_in]),
            hovertemplate=(
                "Time: %{x:.2f} hr<br>"
                "Increment: %{y:.3f} in<br>"
                "Intensity: %{customdata[0]:.2f} in/hr<br>"
                "Cumulative: %{customdata[1]:.3f} in<extra></extra>"
            ),
        )
    )
    fig.add_trace(
        go.Scatter(
            x=storm.time_mid_min / 60.0,
            y=storm.cumulative_depth_in,
            name="Cumulative rainfall",
            yaxis="y2",
            mode="lines",
            line={"color": FNI_GREEN, "width": 3},
            hovertemplate="Time: %{x:.2f} hr<br>Cumulative: %{y:.3f} in<extra></extra>",
        )
    )
    fig.update_layout(
        title=f"Generated 24-hour Hyetograph - {storm.method}",
        xaxis_title="Time from storm start (hr)",
        yaxis_title="Incremental depth per 5-min block (in)",
        yaxis2={"title": "Cumulative depth (in)", "overlaying": "y", "side": "right"},
        template="plotly_white",
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "xanchor": "right", "x": 1},
        margin={"l": 60, "r": 70, "t": 70, "b": 55},
    )
    return fig


def make_idf_figure(atlas: AtlasData, generated_idf: pd.DataFrame) -> go.Figure:
    fig = go.Figure()

    # Do not use a categorical x-axis here. Plotly categorical axes will expand to any
    # category that appears in any trace, which can keep longer-duration labels in
    # the visible plot if a stale or partially filtered trace slips through. A numeric
    # duration axis with an explicit range hard-clips the plot window at 2 days.
    max_duration = float(MAX_ATLAS_DURATION_MIN)
    atlas_plot_df = atlas.depth_table.copy()
    atlas_plot_df["Duration (min)"] = pd.to_numeric(atlas_plot_df["Duration (min)"], errors="coerce")
    atlas_plot_df = atlas_plot_df[
        atlas_plot_df["Duration (min)"].notna()
        & (atlas_plot_df["Duration (min)"] > 0.0)
        & (atlas_plot_df["Duration (min)"] <= max_duration + 1e-9)
    ].copy()

    generated_plot_df = generated_idf.copy()
    generated_plot_df["Duration (min)"] = pd.to_numeric(generated_plot_df["Duration (min)"], errors="coerce")
    generated_plot_df = generated_plot_df[
        generated_plot_df["Duration (min)"].notna()
        & (generated_plot_df["Duration (min)"] > 0.0)
        & (generated_plot_df["Duration (min)"] <= max_duration + 1e-9)
    ].copy()

    duration_minutes = sorted(atlas_plot_df["Duration (min)"].astype(float).unique())
    if not duration_minutes:
        return empty_figure("Atlas 14 IDF Curve Comparisons")
    ticktext = [format_duration(float(minutes)) for minutes in duration_minutes]

    for i, ari in enumerate(atlas.return_periods):
        part = atlas_plot_df[np.isclose(atlas_plot_df["ARI (yr)"], ari)].copy()
        part = part.sort_values("Duration (min)")
        if part.empty:
            continue
        color = ATLAS_LINE_COLORS[i % len(ATLAS_LINE_COLORS)]
        line_width = 3 if np.isclose(ari, REFERENCE_ARI_YR) else 2
        fig.add_trace(
            go.Scatter(
                x=part["Duration (min)"],
                y=part["Intensity (in/hr)"],
                mode="lines+markers",
                name=f"{ari:g}-yr",
                line={"color": color, "width": line_width},
                marker={"size": 5},
                opacity=0.30,
                customdata=part["Duration"],
                hovertemplate="Duration: %{customdata}<br>Intensity: %{y:.3f} in/hr<extra></extra>",
            )
        )

    generated_plot_df = generated_plot_df.sort_values("Duration (min)")
    fig.add_trace(
        go.Scatter(
            x=generated_plot_df["Duration (min)"],
            y=generated_plot_df["Generated Intensity (in/hr)"],
            mode="lines+markers",
            name="Processed storm",
            line={"color": "#000000", "width": 5, "dash": "dash"},
            marker={"size": 8, "symbol": "diamond"},
            customdata=generated_plot_df["Duration"],
            hovertemplate="Duration: %{customdata}<br>Generated intensity: %{y:.3f} in/hr<extra></extra>",
        )
    )

    fig.update_layout(
        title={
            "text": "Atlas 14 IDF Curve Comparisons",
            "x": 0.0,
            "xanchor": "left",
            "y": 0.98,
            "yanchor": "top",
            "font": {"size": 20},
        },
        height=650,
        xaxis={
            "title": "Duration",
            "type": "log",
            "range": [float(np.log10(min(duration_minutes))), float(np.log10(max_duration))],
            "tickmode": "array",
            "tickvals": duration_minutes,
            "ticktext": ticktext,
            "showgrid": True,
        },
        yaxis={"title": "Precipitation intensity (in/hr)", "type": "log"},
        template="plotly_white",
        legend={
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.08,
            "xanchor": "left",
            "x": 0.0,
            "font": {"size": 12},
            "itemsizing": "constant",
        },
        margin={"l": 75, "r": 35, "t": 150, "b": 100},
    )
    return fig

# -----------------------------
# App layout
# -----------------------------

app = Dash(__name__)
server = app.server

app.layout = html.Div(
    style={
        "fontFamily": "Arial, sans-serif",
        "backgroundColor": "#f5f8fa",
        "minHeight": "100vh",
        "padding": "24px",
        "color": FNI_NAVY,
    },
    children=[
        html.Div(
            style={"maxWidth": "1520px", "margin": "0 auto"},
            children=[
                html.H1("Atlas 14 and Temporal Distributions", style={"marginBottom": "8px", "color": FNI_BLUE}),
                html.P(
                    "This teaching app checks your ability to interpret and input Atlas 14 depth values, "
                    "then compares a selected 24-hour temporal distribution against the Atlas 14 IDF curves.",
                    style={"marginBottom": "20px", "maxWidth": "1120px"},
                ),
                html.Div(
                    style={"display": "grid", "gridTemplateColumns": "380px 1fr", "gap": "20px", "alignItems": "start"},
                    children=[
                        html.Div(
                            style=CARD_STYLE,
                            children=[
                                html.H3("Inputs", style={"marginTop": "0", "color": FNI_BLUE}),
                                html.Label("Upload Atlas 14 PDS depth CSV", style={"fontWeight": "bold"}),
                                dcc.Upload(
                                    id="upload-atlas",
                                    children=html.Div("Drag and drop or click to select"),
                                    style=UPLOAD_STYLE,
                                    multiple=False,
                                ),
                                html.Div(id="atlas-file-name", style={"marginTop": "8px", "marginBottom": "16px"}),
                                html.Label("100-year 5-minute depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-5min-depth", type="number", step=0.01, debounce=False, placeholder="Example: 1.01", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 15-minute depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-15min-depth", type="number", step=0.01, debounce=False, placeholder="Example: 2.00", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 1-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-1hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 3.63", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 2-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-2hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 4.71", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 3-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-3hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 5.42", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 6-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-6hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 6.68", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 12-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-12hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 7.93", style={"width": "100%", "padding": "8px"}),
                                html.Label("100-year 24-hour depth read from Atlas 14 (in)", style=CONTROL_LABEL_STYLE),
                                dcc.Input(id="manual-24hr-depth", type="number", step=0.01, debounce=False, placeholder="Example: 9.27", style={"width": "100%", "padding": "8px"}),
                                html.Label("Temporal distribution", style=CONTROL_LABEL_STYLE),
                                dcc.Dropdown(
                                    id="method-dropdown",
                                    value=DEFAULT_DISTRIBUTION_VALUE,
                                    clearable=False,
                                    options=distribution_dropdown_options(DISTRIBUTION_LIBRARY),
                                ),
                                html.Div(
                                    "Temporal distributions are read from CSV files in the temporal_distributions folder next to this app. The dropdown label is the CSV filename without .csv.",
                                    style={**SMALL_TEXT_STYLE, "marginTop": "8px"},
                                ),
                                html.Div(
                                    "The processed storm uses the entered 100-year 24-hour depth if provided; otherwise it uses the uploaded Atlas 14 100-year 24-hour depth.",
                                    style={**SMALL_TEXT_STYLE, "marginTop": "8px"},
                                ),
                                html.Div(style={"height": "14px"}),
                                html.H4("Assumptions", style={"marginBottom": "8px", "color": FNI_BLUE}),
                                html.Ul(
                                    style={"paddingLeft": "20px", "marginBottom": "0"},
                                    children=[
                                        html.Li("Atlas input is a PDS precipitation depth CSV in inches."),
                                        html.Li("Reference event is fixed at the 100-year ARI."),
                                        html.Li("Generated storm duration is 24 hours."),
                                        html.Li("Generated storm timestep is 5 minutes."),
                                        html.Li("Library temporal distributions are unitless cumulative CSVs: fraction_time and fraction_cumulative_depth."),
                                        html.Li("Atlas 14 durations longer than 2 days are excluded from plots and diagnostics."),
                                        html.Li("IDF comparison uses rolling maximum depths from the generated storm."),
                                        html.Li("Durations longer than 24 hours include zero rainfall after the generated storm ends."),
                                    ],
                                ),
                            ],
                        ),
                        html.Div(
                            style={"display": "grid", "gap": "20px"},
                            children=[
                                html.Div(id="status-message", style=CARD_STYLE),
                                html.Div(
                                    style={"display": "grid", "gridTemplateColumns": "repeat(4, minmax(0, 1fr))", "gap": "16px"},
                                    children=[
                                        html.Div(id="metric-location", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-total", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-peak", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-1hr", style=METRIC_CARD_STYLE),
                                    ],
                                ),
                                html.Div(
                                    style={"display": "grid", "gridTemplateColumns": "1fr", "gap": "20px"},
                                    children=[
                                        html.Div(dcc.Graph(id="idf-plot", style={"height": "680px"}, config={"responsive": True}), style=CARD_STYLE),
                                    ],
                                ),
                                html.Div(
                                    style={"display": "grid", "gridTemplateColumns": "1fr", "gap": "20px"},
                                    children=[
                                        html.Div(dcc.Graph(id="hyetograph-plot"), style=CARD_STYLE),
                                    ],
                                ),
                                html.Div(
                                    style=CARD_STYLE,
                                    children=[
                                        html.H3("Atlas 14 Depth Checks and Processed Storm Comparison", style={"marginTop": "0", "color": FNI_BLUE}),
                                        dash_table.DataTable(
                                            id="verification-table",
                                            columns=[
                                                {"name": "Duration", "id": "Duration"},
                                                {"name": "Entered Atlas Depth (in)", "id": "Entered Atlas Depth (in)", "type": "numeric"},
                                                {"name": "Atlas 100-yr Depth (in)", "id": "Atlas 100-yr Depth (in)", "type": "numeric"},
                                                {"name": "Manual Difference (in)", "id": "Manual Difference (in)", "type": "numeric"},
                                                {"name": "Manual Check", "id": "Manual Check"},
                                                {"name": "Processed Storm Max Depth (in)", "id": "Processed Storm Max Depth (in)", "type": "numeric"},
                                                {"name": "Processed - Atlas Depth (in)", "id": "Processed - Atlas Depth (in)", "type": "numeric"},
                                                {"name": "Processed Storm Intensity (in/hr)", "id": "Processed Storm Intensity (in/hr)", "type": "numeric"},
                                                {"name": "Atlas 100-yr Intensity (in/hr)", "id": "Atlas 100-yr Intensity (in/hr)", "type": "numeric"},
                                                {"name": "Processed - Atlas Intensity (in/hr)", "id": "Processed - Atlas Intensity (in/hr)", "type": "numeric"},
                                            ],
                                            data=[],
                                            style_table={"overflowX": "auto"},
                                            style_header={"backgroundColor": FNI_BLUE, "color": "white", "fontWeight": "bold"},
                                            style_cell={"textAlign": "left", "padding": "10px", "border": "1px solid #e3eaee", "whiteSpace": "normal", "height": "auto"},
                                            style_data_conditional=[
                                                {"if": {"filter_query": "{Manual Check} = 'Pass'"}, "backgroundColor": "#f7faee"},
                                                {"if": {"filter_query": "{Manual Check} = 'Check'"}, "backgroundColor": "#fff2ec"},
                                                {"if": {"filter_query": "{Manual Check} = 'Missing'"}, "backgroundColor": "#f8fbfc"},
                                            ],
                                        ),
                                    ],
                                ),
                                html.Details(
                                    style=CARD_STYLE,
                                    children=[
                                        html.Summary("Method notes and limitations", style={"cursor": "pointer", "fontWeight": "bold", "color": FNI_BLUE}),
                                        html.Div(
                                            style={"marginTop": "12px"},
                                            children=[
                                                html.P("Atlas 14 depths are parsed by duration and recurrence interval. Durations longer than 2 days are excluded. Intensities are calculated as depth divided by duration."),
                                                html.P("Library temporal distributions are CSV files with fractional time and fractional cumulative depth. The app interpolates the dimensionless cumulative curve to 5-minute intervals and scales it to the selected 24-hour total."),
                                                html.P("Alternating Block uses the 100-year Atlas 14 depth-duration curve through 24 hours, interpolates intermediate durations on log-log axes, and rearranges incremental depths around the selected center."),
                                                html.P("The processed-storm IDF curve is a diagnostic rolling-maximum curve. It is useful for training because it shows whether a temporal distribution reproduces, exceeds, or falls below Atlas 14 at each duration."),
                                            ],
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
            ],
        )
    ],
)


# -----------------------------
# Callbacks
# -----------------------------

@app.callback(Output("atlas-file-name", "children"), Input("upload-atlas", "filename"))
def show_atlas_filename(filename):
    if not filename:
        return "Using built-in sample until a CSV is uploaded."
    return f"Selected: {filename}"


@app.callback(
    Output("status-message", "children"),
    Output("metric-location", "children"),
    Output("metric-total", "children"),
    Output("metric-peak", "children"),
    Output("metric-1hr", "children"),
    Output("idf-plot", "figure"),
    Output("hyetograph-plot", "figure"),
    Output("verification-table", "data"),
    Input("upload-atlas", "contents"),
    Input("manual-5min-depth", "value"),
    Input("manual-15min-depth", "value"),
    Input("manual-1hr-depth", "value"),
    Input("manual-2hr-depth", "value"),
    Input("manual-3hr-depth", "value"),
    Input("manual-6hr-depth", "value"),
    Input("manual-12hr-depth", "value"),
    Input("manual-24hr-depth", "value"),
    Input("method-dropdown", "value"),
    State("upload-atlas", "filename"),
)
def update_outputs(
    atlas_contents,
    manual_5min,
    manual_15min,
    manual_1hr,
    manual_2hr,
    manual_3hr,
    manual_6hr,
    manual_12hr,
    manual_24hr,
    method,
    atlas_filename,
):
    try:
        text, used_sample = parse_uploaded_text(atlas_contents, SAMPLE_ATLAS14_CSV)
        atlas = parse_atlas14_csv_text(text)

        atlas_24hr_depth = get_depth(atlas, REFERENCE_ARI_YR, STORM_DURATION_MIN)
        applied_24hr = safe_numeric(manual_24hr, fallback=atlas_24hr_depth)
        if applied_24hr <= 0.0:
            raise ValueError("The applied 24-hour rainfall depth must be positive.")

        storm = generate_storm(
            atlas,
            method,
            applied_24hr,
        )
        generated_idf = compute_generated_idf(storm, atlas)
        manual_depths = {
            5.0: manual_5min,
            15.0: manual_15min,
            60.0: manual_1hr,
            120.0: manual_2hr,
            180.0: manual_3hr,
            360.0: manual_6hr,
            720.0: manual_12hr,
            STORM_DURATION_MIN: manual_24hr,
        }
        verify_df = make_depth_check_table(atlas, generated_idf, manual_depths)

        source_text = "built-in sample Atlas 14 CSV" if used_sample else f"uploaded file: {atlas_filename or 'Atlas 14 CSV'}"
        pass_count = int((verify_df["Manual Check"] == "Pass").sum())
        check_count = int((verify_df["Manual Check"] == "Check").sum())
        missing_count = int((verify_df["Manual Check"] == "Missing").sum())

        peak_5min_row = generated_idf[np.isclose(generated_idf["Duration (min)"], 5.0)].iloc[0]
        one_hr_row = generated_idf[np.isclose(generated_idf["Duration (min)"], 60.0)].iloc[0]
        peak_increment = float(storm.incremental_depth_in.max())
        peak_time_hr = float(storm.time_mid_min[int(np.argmax(storm.incremental_depth_in))] / 60.0)

        status = html.Div(
            [
                html.H3("Atlas 14 data loaded", style={"marginTop": "0", "color": FNI_BLUE}),
                html.P(f"Source: {source_text}."),
                html.P(metadata_location_text(atlas)),
                html.P(f"Temporal distribution: {storm.method}."),
                html.P(
                    f"Manual depth checks: {pass_count} pass, {check_count} check, {missing_count} missing. "
                    "The distribution is scaled to the entered 24-hour depth if present. "
                    "Atlas durations longer than 2 days are excluded."
                ),
            ]
        )

        return (
            status,
            metric_card("Location", atlas.metadata.get("Location name (ESRI Maps)", "Unknown"), "from Atlas 14 CSV metadata"),
            metric_card("Applied 24-hr Depth", f"{applied_24hr:.2f} in", f"Atlas reference {atlas_24hr_depth:.2f} in"),
            metric_card("Peak 5-min Intensity", f"{float(peak_5min_row['Generated Intensity (in/hr)']):.2f} in/hr", f"peak block at {peak_time_hr:.2f} hr"),
            metric_card("Generated 1-hr Max", f"{float(one_hr_row['Generated Max Depth (in)']):.2f} in", f"Atlas reference {get_depth(atlas, REFERENCE_ARI_YR, 60.0):.2f} in"),
            make_idf_figure(atlas, generated_idf),
            make_hyetograph_figure(storm),
            verify_df.to_dict("records"),
        )

    except Exception as exc:
        status = html.Div(
            [
                html.H3("Evaluation error", style={"marginTop": "0", "color": FNI_ORANGE}),
                html.P(str(exc)),
            ]
        )
        blank = metric_card("Result", "--", "Check Atlas 14 CSV and manual inputs")
        return (
            status,
            blank,
            blank,
            blank,
            blank,
            empty_figure("Atlas 14 IDF Curve Comparisons"),
            empty_figure("Generated Hyetograph"),
            [],
        )


# -----------------------------
# Entry point
# -----------------------------

if __name__ == "__main__":
    app.run(debug=True)
