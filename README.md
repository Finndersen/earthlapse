# Earth Timeline

An interactive, immersive visualisation of Earth's history — a continuously evolving
photoreal view of the planet's surface across 4.6 billion years, surrounded by live data
layers, fully scrubbable.

Sit back and watch it play, or grab the timeline and explore: zoom from 4.6 billion years
down to a single year, speed it up, slow it down, toggle layers.

> **Status: design phase.** No implementation yet. The design is documented and agreed;
> contracts are next.

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

## Data

Built on open scientific datasets — PALEOMAP PaleoDEMs, GPlates, the Paleobiology Database,
HYDE, TimeTree, ice-core and proxy records. All cited; see
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) and the generated credits page.
