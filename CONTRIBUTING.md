# Contributing

The most valuable contribution is **a new data layer**. It needs no asset regeneration, no
API keys, and no coordination with maintainers.

Read [`docs/DESIGN.md`](docs/DESIGN.md) first.

---

## The split: what you can and can't contribute

**Data layers — freely contributable.** One directory, one PR. A new source normalises into
one of four shapes and the frontend renders it with no changes.

**Generated media — maintainer only.** Images cost money to generate and are nondeterministic;
approved outputs are pinned by hash (ADR-005) and live in R2, not git. A PR cannot add or
change them. If you think a scene should be different, open an issue.

This split is deliberate. Without it you get PRs nobody can merge.

---

## Adding a data layer

### 1. Normalise into one of four shapes

| Shape | Fields |
|---|---|
| `TimeSeries` | `t, value, [uncertainty]` + interpolation policy |
| `EventSet` | `t_min, t_max, label, importance, description, citation` |
| `RasterSequence` | `t, georeferenced grid` |
| `Tree` | `node, parent, t_divergence, label` |

A fifth shape requires an ADR. If your data fits awkwardly, awkward is fine — unbounded is not.

### 2. Create the directory

```
sources/<name>/
  manifest.toml     # url, sha256, licence, citation, time_domain, output_shape, volume
  fetch.py          # → data/raw/<name>/
  normalise.py      # → data/curated/<name>.parquet
  fixture/          # small REAL slice, committed
  README.md         # schema, gotchas, caveats you hit

layers/<id>/
  layer.ts          # implements the Layer interface
  meta.json         # display name, surface, time domain
```

Copy `sources/_template/` to start.

### 3. Rules

- **`t` is years before present**, float, positive into the past. Never calendar dates for
  deep time.
- **Declare your interpolation policy explicitly** in the manifest — linear, log-linear,
  step or nearest. Never leave it implied; a wrong default produces subtly wrong charts
  nobody notices.
- **`Layer.sample()` must be pure in `t`.** Anything else breaks scrubbing.
- **Commit a real fixture.** No test may download a large file or hit a live API. A fresh
  clone must pass tests offline.
- **Cite your source.** `licence` and `citation` in the manifest are mandatory; the credits
  page is generated from them. Most of these datasets are academic and citation is the price
  of use.
- **Uncertainty is data.** If your source has error bars, carry them. Deep-time proxies have
  wide ones and hiding them is dishonest.

### 4. Storage tier

Measure your curated output and place it accordingly:

| Size | Where |
|---|---|
| < 5 MB | git |
| 5–100 MB | git-lfs |
| > 100 MB | R2, hash-manifested |
| raw, any size | never committed |

Say which tier you used, and the measured size, in your PR.

---

## What we'll push back on

- A layer that duplicates an existing one without being clearly better
- Data with unclear licensing
- Anything requiring an API key at *runtime* (build time is fine)
- Adding a heavyweight dependency for one layer
- Changing a **NORMATIVE** section without an ADR

---

## Scientific accuracy

This is an artistic reconstruction and says so in the UI. But **data layers are held to a
higher standard than imagery** — the pictures are plausible, the numbers should be right. If
a source is contested, say so in the source README and carry the uncertainty through to the
chart.

Corrections to dates, values or interpretations are very welcome. Open an issue with a
citation.

---

## Development

```
make data      # fetch and normalise stale sources
pytest         # offline, fixtures only
pnpm dev       # web
```

Python 3.12, pydantic v2, ruff, full type hints. TypeScript strict.
