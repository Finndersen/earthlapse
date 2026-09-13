# Earth Timeline

Interactive visualisation of Earth's history. Photoreal stills evolving across 4.6 Gyr,
surrounded by data layers, fully scrubbable. Fully static frontend, offline Python pipeline.

## Before writing any code

Read [`docs/DESIGN.md`](docs/DESIGN.md). Then the doc for your area:

- data source work → [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
- generation / prompts → [`docs/VISUAL_SPEC.md`](docs/VISUAL_SPEC.md)
- what to build when → [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- why something is the way it is → [`docs/DECISIONS.md`](docs/DECISIONS.md)

Sections marked **NORMATIVE** are contracts: `WorldState` (DESIGN §4), the four curated
shapes (DATA_SOURCES § Contract), the pipeline semantics (DESIGN §9), the `Layer` interface
(DESIGN §10), the style split (VISUAL_SPEC §2). Changing one requires a new ADR — propose
it, do not unilaterally edit.

## Hard rules

- **Never raise `--max-spend`.** Total generation budget is $100, enforced in
  `pipeline/spend.py`. If a build hits the ceiling, stop and report — do not work around it.
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
data/curated/       parquet, one of four shapes
web/                Next.js static export
  scene/            2.5D displaced stills + dissolve
  globe/            independent three.js sphere
  timeline/         warped scale, LOD, scrubbing
  layers/           HUD, sparklines, charts
audio/              stems + Tone.js score
docs/               DESIGN, VISUAL_SPEC, DATA_SOURCES, IMPLEMENTATION, DECISIONS
```

## Commands

```
make data                       # re-run stale source fetch/normalise
earthtime plan                  # what is stale, what it will cost
earthtime build --only images   # generate, respecting pins and ceiling
earthtime review                # candidate picker
earthtime publish               # write data/media/manifest.json + media (local; no upload)
pnpm dev                        # web
```

## Style

Python 3.12, pydantic v2, Typer, ruff, full type hints. TypeScript strict,
react-three-fiber, zustand. Prefer small pure functions and explicit protocols over
frameworks — the codebase should be readable end to end without learning a DSL.
