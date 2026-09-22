# Contributing

The most valuable contribution is **a new data layer**. It needs no asset regeneration, no
API keys, and no coordination with maintainers.

Read [`docs/DESIGN.md`](docs/DESIGN.md) first.

---

## The split: what you can and can't contribute

**Data layers — freely contributable.** One directory, one PR. A new source normalises into
one of four shapes and the frontend renders it with no changes.

**Generated media — maintainer only.** Images cost money to generate and are nondeterministic;
approved outputs are pinned by hash (ADR-005) and committed through Git LFS (ADR-018) — clone
with `git lfs install` done. A PR cannot add or change them. If you think a scene should be different, open an issue.

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

**Downloading a single upstream file?** Call `pipeline.fetching.ensure_verified_artefact`
instead of reimplementing download/verify/cache — it keeps the verified artefact in
`raw_dir` under its own filename and skips the network entirely on a later run if it is
already there and still matches `manifest.toml`'s `sha256`. See `sources/co2-o2/fetch.py`
or `sources/paleodem/fetch.py`.

**Optional `write_outputs` hook.** If `normalise()` needs a side effect outside
`data/curated/` — generated globe textures, say — put it in a `write_outputs(raw_dir:
Path, repo_root: Path) -> None` function in `normalise.py`. `pipeline.databuild` calls it
automatically, right after `normalise()`, if it exists — `normalise()` itself must stay
pure. Declare the files it writes in `manifest.toml`'s optional `outputs` field, as
repo-relative glob patterns (see `sources/_template/manifest.toml`); databuild records how
many files each glob matched and treats the source as stale again if a later run finds
fewer, or none — so deleting generated media makes `make data` regenerate it. See
`sources/paleodem/normalise.py`.

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

## Checks

`scripts/check.sh` (`make check`) is the one definition of "checks pass": pytest, ruff check,
ruff format --check, the web typecheck, the web test suite, the web build, and shellcheck on
`deploy/*.sh`/`scripts/*.sh` if shellcheck is installed. `make check-quick` skips the web build
for a faster local loop; a PR still needs the full run to pass.

`make hooks` (once per clone) points git at `.githooks/`, so `pre-commit` runs ruff on staged
Python files and, when a staged file is under `web/**/*.ts(x)`, the web typecheck — a few seconds,
not the full suite. `git commit --no-verify` skips it when you need to.
