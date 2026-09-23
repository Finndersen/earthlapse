# Source: plates-neoproterozoic

Merdith et al. 2021 continental polygons, 1000-540 Ma, with stylised relief (docs/GLOBE.md
§4.1, G7). `RasterSequence` id `"plates_neoproterozoic"`: 47 globe textures, one every
10 Myr from 1000 to 550 Ma plus one extra frame at 540 Ma for the seam against
`sources/paleodem`'s own 540 Ma frame.

## Status: implemented, downloaded and verified against real bytes

## What was and wasn't downloaded

Zenodo record [4485738](https://zenodo.org/records/4485738) (v1.1b) ships a single file,
`SM2_4485738_V2.zip` (13,912,790 bytes, resolved via the Zenodo API
`https://zenodo.org/api/records/4485738`, not scraped off the landing page — same pattern as
`sources/paleodem`). The zip extracts to one subdirectory, `SM2_X/`, holding 37 members: the
plate topology files for the motion-compensated shader this ticket explicitly excludes (G4,
not built here), palaeomagnetic poles, a GPlates project file, a coastlines file, a 5.7 MB
animation and the three files this source actually uses:

| File | Size (in zip) | Used for |
|---|---|---|
| `shapes_continents_Merdith_et_al.gpml` | 9.5 MB | land mask (`pygplates.PlatePartitioner`) |
| `shapes_cratons_Merdith_et_al.gpml` | 5.4 MB | raised interiors |
| `1000_0_rotfile_Merdith_et_al.rot` | 0.6 MB | reconstruction rotations |

`fetch.py` extracts only these three, flattened out of `SM2_X/` into `raw_dir`.

**Note on `plate_model_manager`.** The task brief named this package as available in the
environment. It was used only to *confirm* pygplates could reconstruct Merdith polygons
before implementing this source (see "Confirming pygplates can reconstruct" below) — not as
`fetch.py`'s download mechanism. `plate_model_manager.PlateModelManager().get_model
("merdith2021")` resolves to a **different** upstream (`10.5281/zenodo.13635864`, a newer
revision the manager's own registry points at) than the Zenodo 4485738 record this ticket and
`docs/GLOBE.md` §3.1 pin. `fetch.py` downloads the pinned zip directly with `httpx`, verified
against a recorded sha256 (`pipeline.fetching.ensure_verified_artefact`, the same helper
`sources/paleodem/fetch.py` uses) — reproducible and pinned to the exact cited record, not to
whatever the manager's registry currently resolves that model name to.

## Schema

Both shape files are GPML (GPlates Markup Language) feature collections. Each feature carries
a `gpml:reconstructionPlateId`, a polygon geometry, and (usually) a `gml:validTime` — not
every feature is valid across the whole 1000-540 Ma window, which is expected: continents
break apart and terranes accrete over a billion years, and `pygplates.PlatePartitioner`
simply drops a feature from the partition at ages outside its own valid time.

The rotation file (`.rot`) is GPlates' plain-text finite-rotation format: one pole
(lat, lon, angle) per plate id per age, referenced to a parent plate id, forming a circuit
back to the fixed reference frame (plate 0). `pygplates.RotationModel` resolves the full
circuit for any plate id at any age within the file's covered range.

## Confirming pygplates can reconstruct

Measured directly against the full downloaded data, reconstructing
`ContinentalPolygons` and `Cratons` and partitioning the full 1024×512 target grid:

| Age | Continents build | Partition (1024×512, both layers) | Land fraction |
|---|---|---|---|
| 1000 Ma | 0.01 s | — (720×360 coarse probe) | 12.7% |
| 750 Ma | 0.01 s | 2.0 s | 15.5% |
| 540 Ma | 0.01 s | — (720×360 coarse probe) | 27.8% |

`PlatePartitioner` builds in milliseconds (it reconstructs its partitioning plates once, up
front) and partitions the full target grid — both the continents and cratons layers, one
`partition_point` query per cell each — in about 2 s. A full 47-frame build (measured, real
data, this source's actual `render_textures`) took **96 s**. Land fraction rises from the
Ediacaran (12.7% at 1000 Ma) toward the Cambrian (27.8% at 540 Ma, close to
`sources/paleodem`'s own measured ~27.6% at the same age — see its README "Deviations" — a
reassuring cross-check at the seam even though the two models don't place continents
identically there).

Reconstruction never failed, crashed, or returned empty at any probed age (1000, 750, 540 Ma)
against the full data. **pygplates can reconstruct
Merdith's continental polygons across the full 1000-550 Ma target range** — nothing here
blocks G7.

One transient `SIGSEGV` was observed once, from a throwaway exploratory script that combined
`pygplates.reconstruct(..., group_with_feature=True)` with several back-to-back
`PlatePartitioner` constructions in one process (never reproduced after simplifying to the
`render_textures` approach actually shipped: `PlatePartitioner(features, rotation_model,
reconstruction_time=age)` directly, no intermediate `reconstruct()` call). Noted here in case
a future change to `relief.py` reintroduces that pattern.

## 540 Ma seam

`sources/paleodem` and this source are two different plate models (PALEOMAP/Scotese &
Wright 2018 vs. Merdith et al. 2021) that do not place continents identically at 540 Ma —
docs/GLOBE.md §4.1 calls this out explicitly and requires a labelled crossfade band, not a
pretence of continuity. This source's frame set includes an explicit `540.0` Ma entry (in
addition to the regular 10 Myr grid down to 550 Ma) purely so the integrator has a same-age
frame to crossfade against `sources/paleodem`'s own `540.0Ma.webp`. The crossfade band itself
(which ages it spans, how the caption reads) is the integrator's call, not this source's —
this source only guarantees both endpoints of that band exist as real, reconstructed frames.
As landed: `web/src/globe/blend.ts`'s `SEAM_BAND` is `[540e6, 550e6]` years BP, and
`globeMultiCaptionFor` labels it "Continents from plate model · relief stylised — 540 Ma
seam, reconstructions do not align".

## Relief model

No elevation data exists for 1000-540 Ma. `relief.py`'s module docstring documents the full
stylised model (land mask from `ContinentalPolygons`, cratons raised, procedural noise seeded
per plate id, shelves from a distance-to-coast transform, uniform abyssal depth) and how each
piece maps onto docs/GLOBE.md §4.1's bullet list. The same `pipeline.palette.elevation_to_rgb`
hypsometric map `sources/paleodem` uses colours the result, factored out of
`sources/paleodem/normalise.py` into `pipeline/palette.py` for exactly this reason — so the
two sources' textures share one palette rather than two that could drift apart.

## Texture generation

Same size, format and encoding as `sources/paleodem`: 1024×512, lossy WebP quality 90 (see
its README "Texture encoding" for the measurement behind that choice — this source reuses it
rather than re-measuring, since the same palette and a similar mix of flat colour regions plus
one coastline edge per frame is the same kind of image). Refs are
`textures/plates_neoproterozoic/<age>Ma.webp`, zero-padded to `NNNN.N` (this source reaches
1000 Ma, unlike paleodem's 3-digit maximum).

`pipeline.databuild` calls `fetch()`, then `normalise()`, then `write_outputs()` automatically:

```
.venv/bin/python -m pipeline.databuild --only plates-neoproterozoic
```

`normalise.py`'s own `main()` remains a manual entry point alongside, mirroring
`sources/paleodem/normalise.py`.

## Sample frames (visual check, real data)

Rendered from the full downloaded data via `write_outputs`, saved to a
scratch directory and inspected directly:

- **1000.0Ma** — a scatter of small to medium landmasses on open ocean, no single
  supercontinent yet assembled; the largest mass sits in the map's eastern third.
- **730.0Ma** (near the start of the Sturtian Snowball window, docs/GLOBE.md §4.3) —
  Rodinia-like clustering: more of the land has drawn together into a few larger,
  irregular masses with a visible pale-blue shelf halo around each coastline.
- **540.0Ma** — a broad band of land across roughly the southern third of the frame reads as
  a single connected mass (consistent with an assembling Gondwana near the south pole at the
  Ediacaran-Cambrian boundary), plus a few smaller separate masses further north.

All three show the same navy abyssal ocean, pale coastal-shelf band, and green-to-yellow land
palette as `sources/paleodem`'s own `540.0Ma.webp` (compared directly, byte for byte
different image but the same control points) — the intended continuity. Per-landmass colour
and fine texture varies (the seeded-per-plate noise, module docstring); coastlines are
polygon-accurate, not blocky, since they come from vector reconstruction rather than a
downsampled raster.

## Fixture

There is no committed fixture: the repository's `.gitignore` excludes `*.gpml` and `*.rot`, so
the trimmed slice once described here (plate id 8013's features plus the whole 612 KB rotation
file) never reached git.

`normalise()` never opens the three raw files — the frame ages are fixed by
`normalise.FRAME_AGES_MA`, not discovered from raw content (unlike `sources/paleodem`, which
parses ages out of its netCDF filenames) — it only checks they exist. So
`tests/sources/test_plates_neoproterozoic.py` builds its raw directory from empty placeholder
files named by `_EXPECTED_RAW_FILENAMES` and asserts the `RasterSequence` shape. `write_outputs()`
(loading `relief.py`, `pygplates`, `scipy`) is exercised manually against the full downloaded
data, never inside the pytest suite — matching docs/GLOBE.md §3.4's stated plan for the sibling
`sources/plates` (G3): "Tests never import gplately."

## Measured volume

- Raw zip: **13,912,790 bytes** (13.3 MB, matches the manifest's declared size and recorded
  sha256 exactly). Kept in `data/raw/plates-neoproterozoic/` (gitignored), verified rather
  than re-downloaded on later runs.
- Extracted raw files (`data/raw/plates-neoproterozoic/`, gitignored): continents 9.1 MB,
  cratons 5.1 MB, rotations 0.6 MB — ~14.8 MB total, a small fraction of the 90 MB the full
  archive extracts to (docs/GLOBE.md §3.1), since only three of its members are kept.
- Curated `data/curated/plates_neoproterozoic.parquet` (47 frames: `t`, `ref`): well under
  the git-tier threshold.
- Generated textures (`data/media/textures/plates_neoproterozoic/*.webp`): **47 files, 1.14 MB
  total** (21-32 KB each, mean ~24.3 KB), rendered in ~96 s on an M-series Mac (dominated by
  the ~2 s/frame `PlatePartitioner` grid queries, not image encoding).

## Storage tier chosen

**git** for the curated parquet — tiny (well under the 5 MB threshold), same tier as
`sources/paleodem`. Textures are **generated media**, per `docs/DATA_SOURCES.md`'s storage
policy ("generated media | git-lfs: pinned images + data/media/"), written to
`data/media/textures/plates_neoproterozoic/` and committed via git-lfs (`.gitattributes`
covers `data/media/**/*.webp`). *Correction, 2026-09-17: an earlier revision of this README
claimed these textures were "gitignored, never committed", which was simply wrong — see
`sources/paleodem/README.md`'s own correction for the same mistake.*

## New dependency: `scipy`

`relief.py`'s shelf-distance calculation uses `scipy.ndimage.distance_transform_edt`. `scipy`
was already present in `.venv` (a transitive dependency of `gplately`) but wasn't declared
directly; added to the `geo` extra in `pyproject.toml` (`scipy>=1.11`) alongside `gplately`,
since both are only needed for this source's (and the future `sources/plates`, G3's) heavy
`write_outputs()` path, never for `normalise()` or the test suite. No other new dependency:
`pygplates` arrives transitively through `gplately` under the same extra; `numpy` and
`pillow` are already declared elsewhere in `pyproject.toml`.

## Shared change: `pipeline/palette.py`

`elevation_to_rgb` (and its control points) moved out of `sources/paleodem/normalise.py` into
a new `pipeline/palette.py`, imported by both sources now. This was necessary, not optional:
docs/GLOBE.md §4.1 requires "the same hypsometric palette as PaleoDEM so the look is
continuous", and duplicating the control points into a second file would have let the two
palettes drift apart silently. `sources/paleodem/normalise.py` re-imports the function under
its original name, so `tests/sources/test_paleodem.py`'s existing
`paleodem_normalise.elevation_to_rgb(...)` calls keep working unchanged (verified: its full
suite still passes).
