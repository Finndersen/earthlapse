# Earth Timeline

Interactive visualisation of Earth's history. Photoreal stills evolving across 4.6 Gyr,
surrounded by data layers, fully scrubbable. Fully static frontend, offline Python pipeline.

## Before writing any code

Read [`docs/DESIGN.md`](docs/DESIGN.md). Then the doc for your area:

- data source work → [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
- generation / prompts → [`docs/VISUAL_SPEC.md`](docs/VISUAL_SPEC.md)
- globe, projection and overlays → [`docs/GLOBE.md`](docs/GLOBE.md)
- what to build when → [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- why something is the way it is → [`docs/DECISIONS.md`](docs/DECISIONS.md)

Sections marked **NORMATIVE** are contracts: `WorldState` (DESIGN §4), the five curated
shapes (DATA_SOURCES § Contract), the pipeline semantics (DESIGN §9), the `Layer` interface
(DESIGN §10), the style split (VISUAL_SPEC §2). Changing one requires a new ADR — propose
it, do not unilaterally edit.

## Hard rules

- **Never raise `--max-spend`.** Total generation budget is $100, enforced in
  `pipeline/spend.py`. If a build hits the ceiling, stop and report — do not work around it.
  Note the footgun: `--max-spend` **overwrites** the ledger's stored ceiling with an absolute
  value, it does not add to it (`Ledger.load`: "CLI flag wins over whatever was stored"). It is a
  **required** option on `earthtime build` — it cannot be left off — so every build retypes the
  ceiling, and a typo silently rewrites it rather than erroring. Always pass exactly
  `--max-spend 100`. Check `spend.json`'s `ceiling_usd` afterwards if you are unsure.
  This is a known design wart: a safety rail you must re-state correctly on every use is one you
  will eventually state wrongly. Making the flag optional and defaulting to the stored ceiling
  needs an ADR, since `pipeline/spend.py` is NORMATIVE.
- **No live API calls or large downloads in tests.** Every source ships a committed fixture
  at `sources/<name>/fixture/`. Use it.
- **Nothing reads `data/curated/` directly.** Go through `WorldState.at(t)`. (ADR-002)
- **`Layer.sample()` must be pure in `t`.** A layer reading anything else breaks scrubbing.
- **Never regenerate a pinned asset.** Pins live in scene records and survive rebuilds. (ADR-005)
- **No generated video for connective transitions.** (ADR-001) Motion is 2.5D displacement
  rendered live in the browser.
- **Never chain image generation off the previous image.** Final scenes render from text
  only: style spec, shot, composition, conditions, subject. (ADR-004, ADR-010)
- **No provider names outside `pipeline/generators/`.** Vendors must stay swappable.
- **If something is unusable, stop and report.** Do not silently substitute a different
  dataset, model or approach.

## Layout

```
sources/<name>/     manifest.toml, fetch.py, normalise.py, fixture/, README.md
pipeline/           models, shapes, asset graph, generators, review CLI, spend ledger
data/raw/           gitignored — reproducible via fetch.py + sha256
data/curated/       parquet, one of five shapes
data/media/         published manifest + media — Git LFS
web/                Next.js static export
  scene/            2.5D displaced stills + dissolve
  globe/            independent three.js sphere
  timeline/         warped scale, LOD, scrubbing
  layers/           HUD, sparklines, charts
audio/              stems + Tone.js score
docs/               DESIGN, VISUAL_SPEC, DATA_SOURCES, IMPLEMENTATION, DECISIONS
```

## Commands

The Python CLI lives in the project venv — always call it as `.venv/bin/earthtime`.

```
python -m pipeline.databuild --only <source> [--force]   # rebuild ONE source into data/curated/
make data                       # re-run every stale source (see "Working in parallel")
earthtime plan                  # what is stale, what it will cost
earthtime build --only images   # generate, respecting pins and ceiling
earthtime review                # candidate picker; review clear <id>, review pick <id> <n>
earthtime publish               # write data/media/manifest.json + media (local; no upload)
```

Checks — all four must pass before handing work back:

```
.venv/bin/python -m pytest -q tests
.venv/bin/ruff check . && .venv/bin/ruff format --check .
pnpm -C web typecheck && pnpm -C web exec vitest run
pnpm -C web build
```

Two traps in that third line, both of which have already produced falsely-green reports:

- **`exec` is required.** `pnpm -C web vitest run` fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "web" not found` — and **still exits 0**, so the `&&` chain succeeds having run no tests at all. Only `pnpm -C web exec vitest run` (or the `test` script) actually runs the suite.
- **The JSON report goes stale.** `web/.vitest/json/output.json` is not cleared between runs, so a crashed or skipped run leaves the previous run's passing report sitting there. `rm -f web/.vitest/json/output.json` before each run, and treat a missing file as a failure, not a pass.

## Verifying UI work

Screenshots are evidence, not verification. **Assert on drawn pixels, never on CSS boxes** — an
element's layout box routinely differs from what is painted inside it, and a check that measures
the box will pass while the thing on screen is wrong.

**But pixel-diffing has its own trap: it needs something to diff against.** `drawnBounds` decides
what is "drawn" by comparing against sampled corner background, which is sound over a flat panel and
worthless over a busy photographic scene with no opaque backing — the photo's own texture registers
as content. It measured 173px of "width" for a completely empty SVG and passed a check that should
have failed. For an SVG trace (sparklines, charts), measure the real element geometry instead —
`polylineTraceBounds` unions the actual `<polyline>` rects and cannot be fooled by the backdrop.
Pick the measurement that matches what is underneath the thing you are measuring.

A check that cannot fail proves nothing. Before trusting a new assertion, run it against the
unfixed build and confirm it actually fails there.

Use the harness at `web/scripts/qa/` (see its README) rather than writing a throwaway Playwright
script: it loads the page once, drives it through `window.__earthtime` without reloading, measures
rendered bounds, fails on console errors, and writes a screenshot contact sheet. Add a shot to its
shot list instead of adding a new script, and give any UI brief a numeric target and the shot that
guards it.

## Working in parallel

Several agents often run at once. The failures that actually happen here are shared-state ones,
not merge conflicts:

- **One writer per file.** Every agent brief lists the paths it owns; nobody edits outside them.
- **Only the coordinator runs `make data`, `earthtime publish` and `git` writes.** A subagent that
  needs curated data rebuilds exactly its own source with `python -m pipeline.databuild --only
  <source>`; `make data` can delete another agent's outputs, and a mid-run `publish` breaks any
  browser check in flight. Publish once, at the end, from one place.
- **Shared-edit files are serialised**, not parallelised: `docs/DECISIONS.md`, `data/scenes.yaml`,
  `data/events.yaml`, `pipeline/publish.py`.
- **Ask before committing or pushing.** Nothing is committed on the user's behalf unasked.

## Style

Python 3.12, pydantic v2, Typer, ruff, full type hints. TypeScript strict,
react-three-fiber, zustand. Prefer small pure functions and explicit protocols over
frameworks — the codebase should be readable end to end without learning a DSL.
