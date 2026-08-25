# Atlas 14 Temporal Distribution Trainer - Static Web Port

This folder is a browser-only port of the Dash prototype. No Python runtime or server-side calculation is required.

## Structure

```text
apps/precipitation_web/
  index.html
  css/app.css
  js/model.js
  js/charts.js
  js/app.js
  vendor/plotly.min.js
  data/temporal_distributions/
    manifest.json
    SCS-type-ii.csv
    SCS-type-iii.csv
```

- `js/model.js`: CSV parsing, validation, interpolation, storm generation, rolling maxima, and table calculations.
- `js/charts.js`: Plotly trace and layout generation.
- `js/app.js`: DOM event listeners, file upload handling, rendering, and application state.
- `index.html`: Static application layout.
- `css/app.css`: FNI-styled responsive layout.

## Run locally

The temporal distribution library is loaded with `fetch`, so serve the folder through a local web server rather than opening `index.html` directly.

From the repository root (the `apps` directory must be served so shared checkpoint assets resolve):

```bash
python -m http.server 8000 -d apps
```

Then open `http://localhost:8000/precipitation_web/`.

The four core checkpoints require an uploaded Atlas 14 frequency CSV. Both depth and intensity exports are accepted, as are partial-duration and annual-maximum series; the model normalizes values to depth internally. The built-in sample is retained for the unlocked temporal-distribution sandbox.

## Add temporal distributions

1. Copy the CSV into `data/temporal_distributions/`.
2. Add its filename to `data/temporal_distributions/manifest.json`.
3. Reload the page.

The dropdown label is the filename without `.csv`. Each file must contain:

```csv
fraction_time,fraction_cumulative_depth
0,0
...
1,1
```

Comment metadata lines beginning with `#` are allowed. The app also tolerates Excel-exported comment lines that are wrapped in quotes.
