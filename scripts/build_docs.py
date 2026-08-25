"""
Publish all static browser training apps into /docs for GitHub Pages.

Run from repo root:

    python scripts/build_docs.py

Output:

    docs/index.html
    docs/precipitation/
    docs/losses/
    docs/transform/
    docs/modified-puls/
"""

from __future__ import annotations

import hashlib
import html
import re
import shutil
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SHARED = ROOT / "apps" / "shared"

COPY_DIRS = ["css", "js", "vendor", "data", "assets"]
COPY_FILES = ["index.html"]


@dataclass(frozen=True)
class WebApp:
    slug: str
    title: str
    source: Path
    description: str


APPS = [
    WebApp(
        slug="precipitation",
        title="1. Precipitation",
        source=ROOT / "apps" / "precipitation_web",
        description="Build and inspect temporal rainfall distributions before converting rainfall to runoff.",
    ),
    WebApp(
        slug="losses",
        title="2. Losses",
        source=ROOT / "apps" / "losses_web",
        description="Apply initial loss, constant loss, and imperviousness to determine excess rainfall.",
    ),
    WebApp(
        slug="transform",
        title="3. Transform",
        source=ROOT / "apps" / "transform_web",
        description="Convert excess precipitation into a runoff hydrograph using flow path and lag assumptions.",
    ),
    WebApp(
        slug="modified-puls",
        title="4. Modified Puls",
        source=ROOT / "apps" / "modified_puls_web",
        description="Route the inflow hydrograph through storage-discharge behavior.",
    ),
]


def iter_source_files(src: Path) -> list[Path]:
    files: list[Path] = []

    for name in COPY_FILES:
        p = src / name
        if p.is_file():
            files.append(p)

    for name in COPY_DIRS:
        d = src / name
        if d.is_dir():
            files.extend(p for p in d.rglob("*") if p.is_file())

    return sorted(files)


def content_token(files: list[Path]) -> str:
    h = hashlib.sha1()
    for p in files:
        h.update(str(p.name).encode("utf-8"))
        h.update(p.read_bytes())
    return h.hexdigest()[:8]


def bust_html(text: str, token: str) -> str:
    """
    Add cache-busting query strings to local static assets.

    Examples:
      css/app.css      -> css/app.css?v=abc12345
      js/app.js        -> js/app.js?v=abc12345
      data/file.csv    -> data/file.csv?v=abc12345
      assets/map.png   -> assets/map.png?v=abc12345
    """
    return re.sub(
        r'((?:href|src)=")((?:(?:css|js|vendor|data|assets)/|\.\./shared/(?:css|js)/)[^"?]+)(")',
        rf"\1\2?v={token}\3",
        text,
    )


def bust_js(text: str, token: str) -> str:
    """
    Add cache-busting query strings to relative ES module imports.
    """
    text = re.sub(
        r'(from\s+[\'"])(\./[^\'"]+\.js)([\'"])',
        rf"\1\2?v={token}\3",
        text,
    )
    text = re.sub(
        r'(import\s*\(\s*[\'"])(\./[^\'"]+\.js)([\'"]\s*\))',
        rf"\1\2?v={token}\3",
        text,
    )
    return text


def mirror_app(app: WebApp, shared_files: list[Path]) -> bool:
    src = app.source
    dst = DOCS / app.slug

    if not src.exists():
        print(f"skipping missing app source: {src}")
        return False

    files = iter_source_files(src)
    if not files:
        print(f"skipping empty app source: {src}")
        return False

    wanted = {p.relative_to(src) for p in files}
    dst.mkdir(parents=True, exist_ok=True)

    for rel in wanted:
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / rel, target)

    for p in sorted(dst.rglob("*"), reverse=True):
        if p.is_file() and p.relative_to(dst) not in wanted:
            p.unlink()

    uses_shared = any("../shared/" in path.read_text(encoding="utf-8") for path in files if path.suffix == ".html")
    token = content_token(files + shared_files if uses_shared else files)

    index = dst / "index.html"
    if index.exists():
        index.write_text(
            bust_html(index.read_text(encoding="utf-8"), token),
            encoding="utf-8",
        )

    for js in (dst / "js").glob("*.js"):
        js.write_text(
            bust_js(js.read_text(encoding="utf-8"), token),
            encoding="utf-8",
        )

    print(f"published {app.slug} to {dst} (v={token})")
    return True


def mirror_shared() -> list[Path]:
    files = sorted(p for p in SHARED.rglob("*") if p.is_file() and "tests" not in p.parts)
    wanted = {p.relative_to(SHARED) for p in files}
    destination = DOCS / "shared"
    destination.mkdir(parents=True, exist_ok=True)
    for source in files:
        target = destination / source.relative_to(SHARED)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for path in sorted(destination.rglob("*"), reverse=True):
        if path.is_file() and path.relative_to(destination) not in wanted:
            path.unlink()
    return files


def write_landing_page(published_apps: list[WebApp]) -> None:
    cards = "\n".join(
        f"""
        <a class="card" href="{html.escape(app.slug)}/">
          <div class="eyebrow">Training module</div>
          <h2>{html.escape(app.title)}</h2>
          <p>{html.escape(app.description)}</p>
        </a>
        """
        for app in published_apps
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stormwater Training Apps</title>
  <style>
    :root {{
      --fni-blue: #015D91;
      --fni-green: #A9C945;
      --fni-navy: #093D5E;
      --neutral-blue: #93AFB4;
      --dark-gray: #4D4D4F;
      --bg: #f5f8fa;
      --card: #ffffff;
      --border: #d9e2e8;
    }}

    * {{
      box-sizing: border-box;
    }}

    body {{
      margin: 0;
      font-family: Arial, sans-serif;
      color: var(--fni-navy);
      background: var(--bg);
    }}

    header {{
      background: var(--fni-blue);
      color: white;
      padding: 34px 24px;
    }}

    .wrap {{
      max-width: 1180px;
      margin: 0 auto;
    }}

    h1 {{
      margin: 0 0 8px;
      font-size: clamp(30px, 4vw, 46px);
      line-height: 1.1;
    }}

    .intro {{
      max-width: 850px;
      margin: 0;
      font-size: 17px;
      line-height: 1.45;
    }}

    main {{
      padding: 26px 24px 42px;
    }}

    .sequence {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 18px;
    }}

    .card {{
      display: block;
      min-height: 220px;
      padding: 22px;
      color: inherit;
      text-decoration: none;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 4px 12px rgba(9, 61, 94, 0.08);
      transition: transform 120ms ease, box-shadow 120ms ease;
    }}

    .card:hover {{
      transform: translateY(-2px);
      box-shadow: 0 8px 18px rgba(9, 61, 94, 0.13);
    }}

    .eyebrow {{
      color: var(--dark-gray);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}

    h2 {{
      margin: 12px 0 10px;
      color: var(--fni-blue);
      font-size: 23px;
      line-height: 1.2;
    }}

    p {{
      line-height: 1.45;
    }}

    .note {{
      margin-top: 22px;
      color: var(--dark-gray);
      font-size: 14px;
    }}

    @media (max-width: 1000px) {{
      .sequence {{
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }}
    }}

    @media (max-width: 620px) {{
      .sequence {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Stormwater Training Apps</h1>
      <p class="intro">
        A browser-based training sequence for moving from design rainfall to losses,
        runoff transform, and reservoir routing.
      </p>
    </div>
  </header>

  <main>
    <div class="wrap">
      <section class="sequence" aria-label="Training sequence">
        {cards}
      </section>

      <p class="note">
        Published from the repository's generated <code>/docs</code> folder.
        Edit the source apps under <code>/apps</code>, then rerun
        <code>python scripts/build_docs.py</code>.
      </p>
    </div>
  </main>
</body>
</html>
"""

    (DOCS / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)

    shared_files = mirror_shared()
    published_apps = []
    for app in APPS:
        if mirror_app(app, shared_files):
            published_apps.append(app)

    write_landing_page(published_apps)
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")

    print(f"published landing page to {DOCS / 'index.html'}")
    print("done")


if __name__ == "__main__":
    main()
