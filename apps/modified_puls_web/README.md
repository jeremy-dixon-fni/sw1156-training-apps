# Modified Puls Routing — Teaching Companion (static web app)

A static, client-side version of the Modified Puls routing tool, built to run entirely in the browser
and deploy to **GitHub Pages**. Trainees first complete five model-review checkpoints covering reach
identity, geometry currency, curve resolution, configurable subreach review, and an integrated final
QC package. Completion unlocks the existing **Concept → Mechanics → Result** explorer.

This is the web companion to the Python/Dash app in `../modified_puls/`. That Dash app remains the
**reference implementation** and the **test oracle**: the JS routing here is a direct port, verified
against golden values exported from it.

## Run locally

No build step. Serve the repository root so the shared checkpoint assets resolve:

```bash
# from the repository root
python -m http.server 8060
# open http://127.0.0.1:8060/apps/modified_puls_web/
```

(Opening `index.html` via `file://` will not work — ES modules require http://.)

## Test

```bash
# 1) export golden values from the Python reference core (needs NumPy >= 2.0)
python ../../scripts/export_golden.py
# 2) run the JS parity test (Node 18+)
node --test test/routing.test.mjs
node --test test/qc.test.mjs
```

Browser regression pages are also available while serving the repository root:

- `apps/modified_puls_web/test/model-browser.html` checks the golden routing results and QC model.
- `apps/modified_puls_web/test/checkpoint-flow.html` completes all five checkpoints, exercises the
  unlocked sandbox, and verifies Reset Training.

## Regenerate embedded presets

Presets (including the Silver Creek 100-yr data in `data/`) are embedded in `js/presets.js`:

```bash
python ../../scripts/build_presets.py
```

## Deploy to GitHub Pages

```bash
python ../../scripts/build_docs.py     # publishes index.html + css/js/vendor into ../../docs/
```

Then in the GitHub repo: **Settings → Pages → Build and deployment → Deploy from a branch**, branch =
your default branch, folder = **/docs**. The site appears at `https://<user>.github.io/<repo>/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Structural shell for the checkpoint sequence and gated explorer |
| `js/routing.js` | Pure routing math (port of the Python core); has no DOM dependencies |
| `js/qc.js` | Scenario data, configurable QC criteria, evaluations, and checkpoint routing comparisons |
| `js/steps.js` | Per-step storage-indication tableau + curve-marker coordinates |
| `js/csv.js` | CSV parse + validation (BOM-stripping; mirrors the Python loaders) |
| `js/presets.js` | Auto-generated embedded teaching examples |
| `js/charts.js` | Explorer and checkpoint Plotly figure builders |
| `js/app.js` | Checkpoint rendering/state plus explorer rail, tabs, stepper, and URL sync |
| `test/` | Node and browser regression tests plus golden values |
| `data/` | Provenance copies of the Silver Creek source CSVs |
