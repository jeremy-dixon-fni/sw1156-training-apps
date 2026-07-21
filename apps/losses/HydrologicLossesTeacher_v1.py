from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import Dash, Input, Output, dcc, html, dash_table


# -----------------------------
# Constants and styling
# -----------------------------

FNI_BLUE = "#015D91"
FNI_GREEN = "#A9C945"
FNI_YELLOW = "#DEB326"
FNI_ORANGE = "#E05126"
FNI_TURQUOISE = "#5BC1CF"
FNI_NAVY = "#093D5E"
FNI_AQUA = "#45A6DD"
FNI_NEUTRAL_BLUE = "#93AFB4"
FNI_DARK_GRAY = "#4D4D4F"
FNI_GRAY = "#B1B1B1"

TOTAL_RAINFALL_IN = 10.0
DT_HR = 0.25
TARGETS = [25.0, 50.0, 75.0, 90.0]
TARGET_TIMES_HR = {25.0: 10.0, 50.0: 11.0, 75.0: 13.0, 90.0: 15.0}

CARD_STYLE = {
    "backgroundColor": "white",
    "border": "1px solid #d9e2e8",
    "borderRadius": "16px",
    "padding": "16px",
    "boxShadow": "0 4px 12px rgba(9, 61, 94, 0.08)",
}

METRIC_CARD_STYLE = {
    "backgroundColor": "white",
    "border": "1px solid #d9e2e8",
    "borderRadius": "16px",
    "padding": "14px 16px",
    "boxShadow": "0 4px 12px rgba(9, 61, 94, 0.08)",
    "minHeight": "112px",
}


# -----------------------------
# Data structures
# -----------------------------

@dataclass
class LossResult:
    time_hr: np.ndarray
    rainfall_in: np.ndarray
    pervious_rainfall_in: np.ndarray
    impervious_runoff_in: np.ndarray
    initial_loss_in: np.ndarray
    constant_loss_in: np.ndarray
    pervious_runoff_in: np.ndarray
    total_runoff_in: np.ndarray
    remaining_initial_loss_in: np.ndarray

    @property
    def total_loss_in(self) -> np.ndarray:
        return self.initial_loss_in + self.constant_loss_in

    @property
    def cumulative_rainfall_in(self) -> np.ndarray:
        return np.cumsum(self.rainfall_in)

    @property
    def cumulative_runoff_in(self) -> np.ndarray:
        return np.cumsum(self.total_runoff_in)

    @property
    def cumulative_initial_loss_in(self) -> np.ndarray:
        return np.cumsum(self.initial_loss_in)

    @property
    def cumulative_constant_loss_in(self) -> np.ndarray:
        return np.cumsum(self.constant_loss_in)

    @property
    def cumulative_total_loss_in(self) -> np.ndarray:
        return np.cumsum(self.total_loss_in)


# -----------------------------
# Sample 24-hour storm
# -----------------------------

def make_training_hyetograph() -> tuple[np.ndarray, np.ndarray]:
    """Create a fixed 24-hour, 10-inch hyetograph at 15-minute intervals."""
    time_hr = np.arange(DT_HR, 24.0 + DT_HR, DT_HR)
    centers = time_hr - 0.5 * DT_HR

    # A synthetic nested storm: light early rain, a strong middle burst, and a smaller tail.
    shape = (
        0.10 * np.exp(-0.5 * ((centers - 6.5) / 2.3) ** 2)
        + 1.00 * np.exp(-0.5 * ((centers - 12.0) / 1.65) ** 2)
        + 0.22 * np.exp(-0.5 * ((centers - 16.8) / 2.4) ** 2)
        + 0.015
    )
    rainfall_in = shape / np.sum(shape) * TOTAL_RAINFALL_IN
    return time_hr, rainfall_in


# -----------------------------
# Hydrologic loss engine
# -----------------------------

def compute_initial_constant_losses(
    initial_loss_in: float,
    constant_loss_rate_in_per_hr: float,
    percent_impervious: float,
) -> LossResult:
    """Compute runoff and losses for an initial-and-constant loss scheme.

    Percent impervious bypasses all losses and becomes direct runoff. Initial and
    constant losses are applied only to the pervious fraction of each rainfall
    increment.
    """
    time_hr, rainfall_in = make_training_hyetograph()
    impervious_fraction = np.clip(percent_impervious / 100.0, 0.0, 1.0)
    pervious_fraction = 1.0 - impervious_fraction

    impervious_runoff_in = rainfall_in * impervious_fraction
    pervious_rainfall_in = rainfall_in * pervious_fraction

    initial_loss = np.zeros_like(rainfall_in)
    constant_loss = np.zeros_like(rainfall_in)
    pervious_runoff = np.zeros_like(rainfall_in)
    remaining_initial = np.zeros_like(rainfall_in)

    remaining = max(float(initial_loss_in), 0.0)
    constant_capacity = max(float(constant_loss_rate_in_per_hr), 0.0) * DT_HR

    for i, rain in enumerate(pervious_rainfall_in):
        initial_take = min(rain, remaining)
        initial_loss[i] = initial_take
        remaining -= initial_take

        available_after_initial = rain - initial_take
        constant_take = min(available_after_initial, constant_capacity)
        constant_loss[i] = constant_take
        pervious_runoff[i] = available_after_initial - constant_take
        remaining_initial[i] = remaining

    return LossResult(
        time_hr=time_hr,
        rainfall_in=rainfall_in,
        pervious_rainfall_in=pervious_rainfall_in,
        impervious_runoff_in=impervious_runoff_in,
        initial_loss_in=initial_loss,
        constant_loss_in=constant_loss,
        pervious_runoff_in=pervious_runoff,
        total_runoff_in=impervious_runoff_in + pervious_runoff,
        remaining_initial_loss_in=remaining_initial,
    )


# -----------------------------
# Summary metrics
# -----------------------------

def first_crossing_time(time_hr: np.ndarray, values_pct: np.ndarray, target_pct: float) -> Optional[float]:
    idx = np.where(values_pct >= target_pct)[0]
    if len(idx) == 0:
        return None
    return float(time_hr[int(idx[0])])


def make_goal_table(result: LossResult) -> pd.DataFrame:
    cumulative_runoff_pct = result.cumulative_runoff_in / TOTAL_RAINFALL_IN * 100.0
    final_runoff_pct = float(cumulative_runoff_pct[-1])

    rows = []
    for target in TARGETS:
        crossing = first_crossing_time(result.time_hr, cumulative_runoff_pct, target)
        target_time = TARGET_TIMES_HR[target]
        if crossing is None:
            crossing_label = "Not reached"
            time_miss_label = "--"
        else:
            crossing_label = f"{crossing:.2f}"
            time_miss_label = f"{crossing - target_time:+.2f}"

        rows.append(
            {
                "Target Runoff (%)": f"{target:.0f}",
                "Current Final Runoff (%)": f"{final_runoff_pct:.1f}",
                "Final Miss (%)": f"{final_runoff_pct - target:+.1f}",
                "Bonus Target Time (hr)": f"{target_time:.0f}",
                "Current Crossing Time (hr)": crossing_label,
                "Time Miss (hr)": time_miss_label,
            }
        )
    return pd.DataFrame(rows)


def initial_loss_satisfied_time(result: LossResult, initial_loss_in: float) -> Optional[float]:
    if initial_loss_in <= 0.0:
        return 0.0
    idx = np.where(result.remaining_initial_loss_in <= 1e-9)[0]
    if len(idx) == 0:
        return None
    return float(result.time_hr[int(idx[0])])


# -----------------------------
# Plotting
# -----------------------------

def make_incremental_figure(result: LossResult) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=result.time_hr,
            y=result.rainfall_in,
            name="Incremental rainfall",
            marker={"color": FNI_BLUE, "opacity": 0.35},
            width=DT_HR * 0.82,
        )
    )
    fig.add_trace(
        go.Bar(
            x=result.time_hr,
            y=result.initial_loss_in,
            name="Initial loss",
            marker={"color": FNI_ORANGE},
            width=DT_HR * 0.58,
        )
    )
    fig.add_trace(
        go.Bar(
            x=result.time_hr,
            y=result.constant_loss_in,
            name="Constant loss",
            marker={"color": FNI_YELLOW},
            width=DT_HR * 0.58,
        )
    )
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=result.total_runoff_in,
            mode="lines",
            name="Incremental runoff",
            line={"color": FNI_NAVY, "width": 3},
        )
    )
    fig.update_layout(
        title="Incremental Rainfall, Losses, and Runoff",
        xaxis_title="Time (hr)",
        yaxis_title="Incremental depth (in)",
        template="plotly_white",
        barmode="overlay",
        legend_title_text="Series",
        margin={"l": 55, "r": 20, "t": 60, "b": 50},
    )
    return fig


def make_cumulative_figure(result: LossResult) -> go.Figure:
    cumulative_rainfall_pct = result.cumulative_rainfall_in / TOTAL_RAINFALL_IN * 100.0
    cumulative_runoff_pct = result.cumulative_runoff_in / TOTAL_RAINFALL_IN * 100.0
    cumulative_initial_loss_pct = result.cumulative_initial_loss_in / TOTAL_RAINFALL_IN * 100.0
    cumulative_constant_loss_pct = result.cumulative_constant_loss_in / TOTAL_RAINFALL_IN * 100.0
    cumulative_total_loss_pct = result.cumulative_total_loss_in / TOTAL_RAINFALL_IN * 100.0

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=cumulative_rainfall_pct,
            mode="lines",
            name="Cumulative rainfall",
            line={"color": FNI_BLUE, "width": 4},
        )
    )
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=cumulative_runoff_pct,
            mode="lines",
            name="Cumulative runoff",
            line={"color": FNI_GREEN, "width": 4},
        )
    )
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=cumulative_total_loss_pct,
            mode="lines",
            name="Cumulative total loss",
            line={"color": FNI_ORANGE, "width": 3},
        )
    )
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=cumulative_initial_loss_pct,
            mode="lines",
            name="Cumulative initial loss",
            line={"color": FNI_ORANGE, "width": 2, "dash": "dot"},
            visible="legendonly",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=result.time_hr,
            y=cumulative_constant_loss_pct,
            mode="lines",
            name="Cumulative constant loss",
            line={"color": FNI_YELLOW, "width": 2, "dash": "dot"},
            visible="legendonly",
        )
    )

    for target, target_time in TARGET_TIMES_HR.items():
        fig.add_hline(
            y=target,
            line={"color": FNI_GRAY, "width": 1, "dash": "dot"},
            annotation_text=f"{target:.0f}%",
            annotation_position="right",
        )
        fig.add_vline(
            x=target_time,
            line={"color": FNI_NEUTRAL_BLUE, "width": 1, "dash": "dot"},
        )

    fig.update_layout(
        title="Cumulative Rainfall, Runoff, and Losses as Percent of Total Rainfall",
        xaxis_title="Time (hr)",
        yaxis_title="Cumulative depth (% of 10-inch storm)",
        template="plotly_white",
        legend_title_text="Series",
        margin={"l": 60, "r": 20, "t": 60, "b": 50},
        yaxis={"range": [0, 105]},
    )
    return fig


# -----------------------------
# UI helpers
# -----------------------------

def build_metric_card(title: str, value: str, subtitle: str) -> html.Div:
    return html.Div(
        [
            html.Div(title, style={"fontSize": "14px", "fontWeight": "bold", "color": FNI_DARK_GRAY, "marginBottom": "8px"}),
            html.Div(value, style={"fontSize": "28px", "fontWeight": "bold", "color": FNI_BLUE, "marginBottom": "6px"}),
            html.Div(subtitle, style={"fontSize": "14px", "color": FNI_DARK_GRAY}),
        ]
    )


def make_status_panel(initial_loss: float, constant_rate: float, impervious_pct: float, result: LossResult) -> html.Div:
    final_runoff_in = float(result.cumulative_runoff_in[-1])
    final_runoff_pct = final_runoff_in / TOTAL_RAINFALL_IN * 100.0
    final_loss_in = float(result.cumulative_total_loss_in[-1])
    final_loss_pct = final_loss_in / TOTAL_RAINFALL_IN * 100.0
    sat_time = initial_loss_satisfied_time(result, initial_loss)
    if sat_time is None:
        sat_text = "Initial loss is not fully satisfied by the pervious rainfall."
    else:
        sat_text = f"Initial loss is satisfied at approximately {sat_time:.2f} hr."

    return html.Div(
        [
            html.H3("Current Scenario", style={"marginTop": "0", "color": FNI_BLUE}),
            html.P(
                f"Initial loss = {initial_loss:.1f} in, constant loss rate = {constant_rate:.2f} in/hr, impervious area = {impervious_pct:.0f}%."
            ),
            html.P(f"Final runoff = {final_runoff_in:.2f} in ({final_runoff_pct:.1f}% of rainfall). Final loss = {final_loss_in:.2f} in ({final_loss_pct:.1f}% of rainfall)."),
            html.P(sat_text),
        ]
    )


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
            style={"maxWidth": "1500px", "margin": "0 auto"},
            children=[
                html.H1("Hydrologic Losses Explorer", style={"marginBottom": "8px", "color": FNI_BLUE}),
                html.P(
                    "Learning objective: see how initial loss, constant loss rate, and impervious cover control the timing and volume of runoff from a fixed 24-hour, 10-inch storm.",
                    style={"marginBottom": "20px", "maxWidth": "1120px"},
                ),
                html.Div(
                    style={
                        "display": "grid",
                        "gridTemplateColumns": "360px 1fr",
                        "gap": "20px",
                        "alignItems": "start",
                    },
                    children=[
                        html.Div(
                            style=CARD_STYLE,
                            children=[
                                html.H3("Inputs", style={"marginTop": "0", "color": FNI_BLUE}),
                                html.Label("Initial loss (in)", style={"fontWeight": "bold"}),
                                dcc.Slider(
                                    id="initial-loss-slider",
                                    min=0.0,
                                    max=6.0,
                                    step=0.1,
                                    value=1.0,
                                    marks={0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6"},
                                    tooltip={"placement": "bottom", "always_visible": True},
                                ),
                                html.Div(style={"height": "22px"}),
                                html.Label("Constant loss rate (in/hr)", style={"fontWeight": "bold"}),
                                dcc.Slider(
                                    id="constant-loss-slider",
                                    min=0.0,
                                    max=1.0,
                                    step=0.05,
                                    value=0.20,
                                    marks={0: "0", 0.25: "0.25", 0.5: "0.50", 0.75: "0.75", 1.0: "1.00"},
                                    tooltip={"placement": "bottom", "always_visible": True},
                                ),
                                html.Div(style={"height": "22px"}),
                                html.Label("Impervious area (%)", style={"fontWeight": "bold"}),
                                dcc.Slider(
                                    id="impervious-slider",
                                    min=0,
                                    max=100,
                                    step=5,
                                    value=30,
                                    marks={0: "0", 25: "25", 50: "50", 75: "75", 100: "100"},
                                    tooltip={"placement": "bottom", "always_visible": True},
                                ),
                                html.Div(style={"height": "18px"}),
                                html.H4("Rules represented", style={"marginBottom": "8px", "color": FNI_BLUE}),
                                html.Ul(
                                    style={"paddingLeft": "20px", "marginBottom": "0"},
                                    children=[
                                        html.Li("The storm is fixed at 10.0 inches over 24 hours."),
                                        html.Li("Impervious rainfall bypasses losses and becomes direct runoff."),
                                        html.Li("Initial loss is applied only to the pervious fraction."),
                                        html.Li("After initial loss is satisfied, constant loss is applied to the remaining pervious rainfall."),
                                        html.Li("Any pervious rainfall left after those losses becomes runoff."),
                                    ],
                                ),
                            ],
                        ),
                        html.Div(
                            style={"display": "grid", "gap": "20px"},
                            children=[
                                html.Div(id="status-message", style=CARD_STYLE),
                                html.Div(
                                    style={
                                        "display": "grid",
                                        "gridTemplateColumns": "repeat(4, minmax(0, 1fr))",
                                        "gap": "16px",
                                    },
                                    children=[
                                        html.Div(id="metric-runoff", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-loss", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-impervious", style=METRIC_CARD_STYLE),
                                        html.Div(id="metric-peak", style=METRIC_CARD_STYLE),
                                    ],
                                ),
                                html.Div(
                                    style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "20px"},
                                    children=[
                                        html.Div(dcc.Graph(id="incremental-plot"), style=CARD_STYLE),
                                        html.Div(dcc.Graph(id="cumulative-plot"), style=CARD_STYLE),
                                    ],
                                ),
                                html.Div(
                                    style=CARD_STYLE,
                                    children=[
                                        html.H3("Runoff Target Tracker", style={"marginTop": "0", "color": FNI_BLUE}),
                                        html.P(
                                            "The final-runoff target is based on total cumulative runoff as a percent of the 10-inch storm. The bonus time checks when cumulative runoff first crosses each target percentage."
                                        ),
                                        dash_table.DataTable(
                                            id="goal-table",
                                            columns=[
                                                {"name": "Target Runoff (%)", "id": "Target Runoff (%)"},
                                                {"name": "Current Final Runoff (%)", "id": "Current Final Runoff (%)"},
                                                {"name": "Final Miss (%)", "id": "Final Miss (%)"},
                                                {"name": "Bonus Target Time (hr)", "id": "Bonus Target Time (hr)"},
                                                {"name": "Current Crossing Time (hr)", "id": "Current Crossing Time (hr)"},
                                                {"name": "Time Miss (hr)", "id": "Time Miss (hr)"},
                                            ],
                                            data=[],
                                            style_table={"overflowX": "auto"},
                                            style_header={"backgroundColor": FNI_BLUE, "color": "white", "fontWeight": "bold"},
                                            style_cell={"textAlign": "left", "padding": "10px", "border": "1px solid #e3eaee"},
                                            style_data_conditional=[
                                                {"if": {"row_index": "odd"}, "backgroundColor": "#f8fbfc"},
                                            ],
                                        ),
                                    ],
                                ),
                                html.Details(
                                    style=CARD_STYLE,
                                    children=[
                                        html.Summary("Method details", style={"cursor": "pointer", "fontWeight": "bold", "color": FNI_BLUE}),
                                        html.Div(
                                            style={"marginTop": "12px"},
                                            children=[
                                                html.P("For each time step, rainfall is split into impervious and pervious components."),
                                                html.P("Impervious runoff equals rainfall multiplied by percent impervious. This portion does not see either the initial loss or the constant loss rate."),
                                                html.P("Pervious rainfall first fills the remaining initial loss. Once that storage is full, the constant loss rate is converted to a time-step loss capacity and subtracted from the remaining pervious rainfall."),
                                                html.P("The model enforces mass balance at every time step: rainfall equals runoff plus initial loss plus constant loss."),
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

@app.callback(
    Output("status-message", "children"),
    Output("metric-runoff", "children"),
    Output("metric-loss", "children"),
    Output("metric-impervious", "children"),
    Output("metric-peak", "children"),
    Output("incremental-plot", "figure"),
    Output("cumulative-plot", "figure"),
    Output("goal-table", "data"),
    Input("initial-loss-slider", "value"),
    Input("constant-loss-slider", "value"),
    Input("impervious-slider", "value"),
)
def update_outputs(initial_loss, constant_rate, impervious_pct):
    result = compute_initial_constant_losses(
        initial_loss_in=float(initial_loss),
        constant_loss_rate_in_per_hr=float(constant_rate),
        percent_impervious=float(impervious_pct),
    )

    final_runoff_in = float(result.cumulative_runoff_in[-1])
    final_runoff_pct = final_runoff_in / TOTAL_RAINFALL_IN * 100.0
    total_loss_in = float(result.cumulative_total_loss_in[-1])
    total_loss_pct = total_loss_in / TOTAL_RAINFALL_IN * 100.0
    direct_impervious_in = float(np.sum(result.impervious_runoff_in))
    direct_impervious_pct = direct_impervious_in / TOTAL_RAINFALL_IN * 100.0
    peak_incremental_runoff = float(np.max(result.total_runoff_in))
    peak_time = float(result.time_hr[int(np.argmax(result.total_runoff_in))])

    goal_table = make_goal_table(result)

    return (
        make_status_panel(float(initial_loss), float(constant_rate), float(impervious_pct), result),
        build_metric_card("Final Runoff", f"{final_runoff_pct:.1f}%", f"{final_runoff_in:.2f} in of 10.00 in"),
        build_metric_card("Final Loss", f"{total_loss_pct:.1f}%", f"{total_loss_in:.2f} in total loss"),
        build_metric_card("Impervious Runoff", f"{direct_impervious_pct:.1f}%", f"{direct_impervious_in:.2f} in bypassed losses"),
        build_metric_card("Peak Increment", f"{peak_incremental_runoff:.2f} in", f"at {peak_time:.2f} hr"),
        make_incremental_figure(result),
        make_cumulative_figure(result),
        goal_table.to_dict("records"),
    )


if __name__ == "__main__":
    app.run(debug=True)