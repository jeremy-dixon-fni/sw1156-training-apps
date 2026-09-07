# Transform Flow Path Explorer - Static JavaScript Port v1.3

The status panel displays `Static build 1.3.0` so deployment can be verified directly in the page. The checkpoint flow supports optional Atlas 14 CSV verification and uses terrain-backed QC maps with subcatchment delineations.

# Transform Flow Path Explorer - Static JavaScript Port

This folder is a browser-only port of `TransformFlowPathTrainer_v4.py`. It preserves the three Version 4 training tabs and separates engineering calculations, Plotly figures, and interface wiring.

## File structure

```text
apps/transform_web/
  index.html
  css/app.css
  js/model.js
  js/charts.js
  js/app.js
  vendor/plotly.min.js
  assets/flow_paths_map.png
  assets/checkpoint-flow-path-qc.webp
  assets/checkpoint-surface-qc.webp
  tests/model.test.js
```

## Layer mapping

| Python/Dash layer | Static JavaScript equivalent |
|---|---|
| Constants and data classes | Plain objects and constants in `js/model.js` |
| NumPy/Pandas calculations | Array functions in `js/model.js` |
| Plotly figure functions | `js/charts.js` |
| Dash layout | `index.html` and `css/app.css` |
| Dash callbacks | DOM event listeners in `js/app.js` |

`model.js` has no DOM or Plotly dependency. It can be loaded in a browser or required directly by Node for tests.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/apps/transform_web/
```

No package installation or build step is required.

## Test the engineering model

```bash
node apps/transform_web/tests/model.test.js
```

The regression checks cover:

- embedded 5-minute excess-precipitation series
- shortened flow-path geometry and drainage area
- default TR-55 results
- sheet, shallow-flow, and channel-velocity sensitivity
- default Kerby-Kirpich results
- NRCS gamma unit-hydrograph calculations
- lag-ratio and peak-rate-factor sensitivity envelope
- Atlas 14 depth/intensity CSV parsing for the 2-year, 24-hour depth

## Deployment

The app uses relative paths and is compatible with GitHub Pages. Copy or commit the complete `apps/transform_web/` directory, including the local Plotly vendor file and map assets.
