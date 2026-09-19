# Earthlapse

An interactive, immersive visualisation of Earth's history — a continuously evolving
photoreal view of the planet's surface across 4.6 billion years, surrounded by live data
layers, fully scrubbable.

Sit back and watch it play, or grab the timeline and explore: zoom from 4.6 billion years
down to a single year, speed it up, slow it down, toggle layers.

> **Status: in development.** The pipeline and viewer run end to end locally; see
> [Local development](#local-development).

---

## What it is

A single view of Earth's surface evolving through deep time — magma ocean, Archean shore,
Carboniferous swamp, Cretaceous forest, Pleistocene steppe, city — as photoreal generated
imagery, breathing with subtle parallax and dissolving from one age into the next.

Around it: an independent 3D globe driven by real paleogeographic data, and a set of data
layers — atmospheric CO₂ and oxygen, temperature, sea level, biodiversity, human population,
the length of a day, the Moon's distance, and the organism that was your direct ancestor at
that moment.

Everything is a pure function of one time cursor, so playback and exploration are the same
mechanism.

## Principles

- **Continuity over comprehensiveness.** Plausibility is the bar, not precision.
- **Real data wherever real data exists.** Only the *view* is generated.
- **Everything is a pure function of `t`.**
- **Nothing pre-rendered that could be rendered live.** No video files.
- **Contributable.** A new data layer is one directory and one PR.

It is an artistic reconstruction, and says so.

## Documentation

| Document | What's in it |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Architecture, time model, `WorldState`, scene rendering, layout |
| [`docs/VISUAL_SPEC.md`](docs/VISUAL_SPEC.md) | Art direction, prompt architecture, style contract |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) | Every dataset — access, volume, storage, processing |
| [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) | Phasing and agent work packages |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADR log |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to add a data layer |

Start with `DESIGN.md`.

## Stack

Python 3.12 for the offline pipeline (pydantic, gplately, xarray, Typer). Next.js +
TypeScript + react-three-fiber for the viewer. Fully static — media on Cloudflare R2, site
on Pages, no backend.

## Local development

### Prerequisites

- Python 3.12 ([uv](https://docs.astral.sh/uv/) recommended)
- Node.js 24 and pnpm 10
- [Git LFS](https://git-lfs.com/): published images and audio under `data/media/` are LFS objects

### Setup

```sh
git lfs install
git clone https://github.com/Finndersen/earthview.git && cd earthview
git lfs pull

# Python pipeline. Extras: dev = tests/lint, data = source normalisation,
# geo = plate reconstructions, morph = portrait flow fields
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[dev,data,geo,morph]'

# Web viewer
cd web && pnpm install && cd ..

# Serve the published media to the viewer (gitignored symlink)
ln -s ../../data/media web/public/media
```

### Run the viewer

```sh
make web-dev        # or: cd web && pnpm dev  →  http://localhost:3000
make web-build      # static export to web/out/
```

The viewer loads `/media/manifest.json`. Without the `web/public/media` symlink it falls back
to the placeholder manifest in `web/public/stub/`.

### Tests and checks

```sh
make test                                   # Python tests (offline, fixture-backed)
.venv/bin/ruff check . && .venv/bin/ruff format --check .

cd web
pnpm test                                   # vitest
pnpm typecheck
```

### Pipeline

Everything the viewer needs is already committed. You only need these to change data or media.

```sh
make data                                   # rebuild stale sources into data/curated/
.venv/bin/python -m pipeline.databuild --only <source> --force   # rebuild one source

.venv/bin/earthtime plan                    # what is stale and what it would cost (spends nothing)
.venv/bin/earthtime build --max-spend <USD> --only images --candidates 1
.venv/bin/earthtime review                  # pick candidates; `review portraits` for portraits
.venv/bin/earthtime morph                   # portrait flow fields (local, free)
make pins                                   # stage pinned candidates for commit
.venv/bin/earthtime publish --allow-unpinned # write data/media/manifest.json + media
```

`build` calls a paid image generator. It needs generator credentials in a gitignored `.env`
(see `pipeline/generators/`). Spend is capped by the ledger in `spend.json`. Adding a data
layer needs neither: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Data

Built on open scientific datasets — PALEOMAP PaleoDEMs, GPlates, the Paleobiology Database,
HYDE, TimeTree, ice-core and proxy records. All cited; see
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) and the generated credits page.
