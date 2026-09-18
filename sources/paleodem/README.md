# Source: paleodem

PALEOMAP PaleoDEMs (Scotese & Wright 2018), the backbone of the globe view. `RasterSequence`
id `"paleodem"` (all 109 epochs as globe textures, 0-540 Ma) + `TimeSeries` id
`"land_fraction"` (the same 109 epochs), both from the same raw grids.

## Status: implemented, downloaded and verified against real bytes

`zenodo.org` flapped with HTTP 504s for hours on a previous attempt; it round-tripped cleanly
on this one (confirmed both the record's API JSON and the target file download, byte for
byte against the recorded sha256 — see "Measured volume"), then flapped again transiently
mid-build (one 504, resolved on retry) — consistent with what the brief warned to expect,
not a dead host.

## What was and wasn't downloaded

Zenodo record [5460860](https://zenodo.org/records/5460860) lists 6 files, 414.7 MB total.
**Only** `Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc.zip` (9,302,291 bytes,
md5 `77147998623ab039d86ff3e0b5e40344`) is fetched — resolved via the Zenodo API
(`https://zenodo.org/api/records/5460860`), not scraped off the landing page, per the task
brief. The other 5 files (6-arcmin netCDF, two shapefile/atlas bundles, a CSV export, the
PDF writeup) are never requested by `fetch.py` and were not downloaded during this
investigation either — including the PDF documentation itself, which is why the vertical
datum note below is inferred from the data and the record's own metadata description,
not confirmed by reading it.

## Schema

The zip extracts to one subdirectory (`Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc_v2/`)
containing `License.txt`, one `.gpml` (GPlates project file, unused here), and **109** files
each shipped as a matched trio: `Map<NN>_PALEOMAP_1deg_<name>_<Ma>Ma.nc` plus two
`.gplates.cache` viewer-cache siblings (also unused — `fetch.py` extracts only the `.nc`
grids, flattened out of the versioned subdirectory).

Each `.nc` (**CONFIRMED by opening every one of the 109 files**, not just documentation):

| | |
|---|---|
| Variable | `z`, dims `(lat, lon)` = `(181, 361)`, `float32`, metres |
| `lat` | -90..90, step 1°, ascending (index 0 = -90/south) |
| `lon` | -180..180, step 1°, ascending, **both** -180 and +180 present (node-registered — see "Projection" below) |
| Conventions attr | `COARDS, CF-1.5` |
| `history` attr | a GMT `grdsample` invocation resampling from the source's finer native grid — confirms these 1° files are themselves a downsample, not primary data (relevant to the vertical-range deviation below) |

Age is **not** a netCDF variable, coordinate, or attribute anywhere — it is encoded only in
the filename, as a `_<Ma>Ma.nc` suffix (`Ma` can be an integer or a decimal, e.g.
`385.2Ma`). `sources/paleodem/normalise.py`'s `_discover_raw_files` is the one place that
parses it, via `_(\d+(?:\.\d+)?)Ma\.nc$`. Several filenames contain literal spaces (e.g.
`Map49_PALEOMAP_1deg_Permo-Triassic Boundary_250Ma.nc`) — the regex anchors on the
filename's end, so this doesn't matter, but it means naive whitespace-splitting parsers
would break.

## VERIFY items resolved (docs/DATA_SOURCES.md)

- **Timestep spacing — NOT perfectly even.** 109 epochs span 0-540 Ma. Most adjacent pairs
  are exactly 5 Myr apart, but a handful of boundary maps break that: measured gaps are
  `{4.5, 5.0, 5.2, 5.3}` Myr (e.g. 385.2 Ma sits 4.8 Myr after 380 Ma and 5.3 before 390.5
  Ma — inserted extra "boundary" maps at stratigraphic stage boundaries, not a uniform
  resample). `normalise.py` never assumes even spacing: it emits exactly the real available
  ages, and frame refs keep one decimal (`385.2Ma.webp`) so boundary maps aren't renamed.
- **Vertical datum / sea-level convention — z is metres relative to (paleo) sea level.**
  Not confirmed from the PDF (not downloaded — see above), but confirmed from two
  independent sources that were opened: (1) the Zenodo record's own metadata description
  — "an estimate of the elevation of the land surface **and depth of the ocean basins**
  measured in meters" — and (2) the data itself: every epoch's `z` spans a contiguous
  range straddling exactly 0, with negative values forming the ocean basins and positive
  the continents (see "Global elevation range" below), which is only consistent with a
  sea-level-relative convention. This directly matches the project's `land = z > 0`
  convention used for `land_fraction` and the texture colour map.
- **No-data sentinel — none.** Scanned every cell of all 109 files: zero `NaN`s anywhere.
  The grid is dense; every 1°x1° cell in the whole 181x361 domain, for every epoch, carries
  a real elevation value. There is no sentinel to filter.
- **Projection — plain geographic (lat/lon) grid, node-registered, not a named CRS.**
  No CRS/EPSG attribute is present in the file at all. The grid is regularly spaced 1° in
  both axes and spans the full sphere inclusive of both edges (181 = 180/1 + 1 lat points
  from pole to pole; 361 = 360/1 + 1 lon points, with both -180 and +180 present as the
  same physical meridian) — this is GMT/COARDS "gridline" (node) registration, matching
  the docs' claim. Treated as equirectangular / EPSG:4326-shaped for the purposes of this
  project (there is no other geographic reference it could sensibly be); no reprojection is
  applied. `_render_frame` drops the duplicate +180 column before building the texture so
  the seam isn't double-weighted.
- **Age encoding — filename only, per-file, no in-file time coordinate.** See "Schema"
  above.

## Deviations from docs/DATA_SOURCES.md

- **Coverage is 109 files, not the 117 the record's own description advertises.**
  `docs/DATA_SOURCES.md` and the Zenodo record's metadata both say 117 rasters; this
  specific zip (the 1° netCDF bundle) contains 109 `.nc` files. The discrepancy is most
  likely 117 counting sub-variants across the different distributed formats/resolutions in
  the record as a whole (or an outdated figure carried over between record revisions) —
  not a truncated download (sha256 of the whole zip matches exactly, and 109 is the
  complete, gap-free count for every age this bundle actually ships). Not investigated
  further since it doesn't affect anything downstream: the globe and `land_fraction` both
  use all 109 real epochs rather than a documented 117.
- **Global elevation range measured -9,000 to +10,500 m, not documented -11,000 to
  +10,500 m.** Scanned every cell of all 109 files (not just 0 Ma). The likely explanation,
  visible directly in each file's own `history` attribute (a GMT `grdsample` resampling
  command): this 1°-resolution product is itself downsampled from a finer native grid (the
  record's other file, the 6 arcmin version, not downloaded here per the task's volume
  constraint), and resampling/averaging a finer bathymetry grid to 1° smooths away the
  deepest, spatially narrow trench cells. The colour map still clamps to the documented
  -11,000..+10,500 range (`sources/paleodem/normalise.py`'s `_SEA_STOPS`/`_LAND_STOPS`) so
  it stays correct even for epochs or future re-fetches of finer data that do reach -11,000.
- **Area-weighted land fraction at 0 Ma measures ~0.276, not ~0.29.** The commonly quoted
  "Earth is 29% land" figure is close to what an *unweighted* per-grid-cell count gives on
  this dataset (0.290 measured) — but that overweights high-latitude land, because lines of
  longitude converge toward the poles while the grid samples them at constant angular
  spacing. Genuinely cos(latitude) area-weighting the same 0 Ma grid (`_land_fraction`,
  verified against a second, independent latitude-band/`sin`-difference weighting that
  agrees to 5 decimal places) gives **0.27598**. `tests/sources/test_paleodem.py`'s
  tolerance (±0.03 around 0.29) is sized to cover this specific, measured gap between the
  two conventions while still catching a materially broken implementation (an unweighted
  count also happens to fall inside this tolerance, deliberately, since it's the natural
  "did you forget to weight?" bug; a sign error lands at ~0.72, well outside it).

  **Review fix:** `_land_fraction` originally weighted all 361 longitude columns, including
  both the -180 and +180 columns the grid ships as duplicates of the same physical meridian
  (node registration — see "Projection" above); `_render_frame` already dropped that
  duplicate column before rendering textures ("the seam isn't double-weighted") but
  `_land_fraction` didn't apply the same treatment, so it double-counted one meridian's
  land/sea state. The bias was tiny (0.27525 -> 0.27598 at 0 Ma, both inside every existing
  test tolerance) but a genuine inconsistency between two functions solving the identical
  problem. Fixed by factoring the drop into a shared `_drop_duplicate_lon_column` helper
  used by both `_land_fraction` and `_render_frame`.

## Texture generation

`normalise.py` emits one frame per raw epoch: all 109, 0-540 Ma (ADR-013). An earlier version
published only 12 (every 50 Myr), so the globe crossfaded across 50 Myr gaps and continents
faded out and back in rather than moving; at ~5 Myr spacing land moves 1-3° between frames
(measured, docs/GLOBE.md §3), so the crossfade reads as drift. Refs are
`textures/paleodem/<age>Ma.webp` with the age zero-padded to one decimal (`000.0Ma.webp`,
`385.2Ma.webp`, `540.0Ma.webp`) so listings sort chronologically and the two off-grid
boundary epochs keep their real ages.

### Texture encoding

Measured on the real grids (one epoch in nine, 13 frames, then all 109 for the chosen format):

| Size | Encoding | Mean per frame | All 109 |
|---|---|---|---|
| 1024x512 | PNG (optimised, lossless) | 264 KB | 29.5 MB |
| 1024x512 | WebP lossless | 203 KB | 22.6 MB |
| 1024x512 | JPEG q88 | 53 KB | 5.9 MB |
| **1024x512** | **WebP q90 (chosen)** | **35 KB** | **3.91 MB** (measured, all 109) |
| 720x360 | PNG | 159 KB | 17.7 MB |
| 720x360 | WebP q90 | 22 KB | 2.5 MB |

Chosen: **1024x512 lossy WebP, quality 90**. PSNR against the lossless render is 37.6 dB at
0 Ma (the busiest frame), 42.0 dB at 250 Ma and 43.7 dB at 540 Ma; 99th-percentile channel
error 6-14 levels. The tint is smooth ramps plus one coastline edge, which lossy WebP holds
well. PNG at the same size is at the ~30 MB ceiling on its own; dropping to 720x360 would throw
away detail the 1024 bilinear upsample of the 360-column grid still shows on the expanded globe.
Width stays 1024 because the source only has ~360 columns of information: wider adds bytes,
not detail. Every browser the viewer targets decodes WebP. A future plate-id raster
(docs/GLOBE.md) must be a separate, lossless file; never encode ids lossily.

`render_textures` also deletes any file in `data/media/textures/paleodem/` that isn't one of
the current frames. The directory belongs to this source, so the old `NNNMa.png` files from
the 12-frame build don't linger after a rebuild.

The hypsometric colour map (`elevation_to_rgb`, one pure function per the brief) is a single
fixed set of control points shared by every epoch, so the globe's cross-fade blends colour
continuously rather than jumping between differently-tuned palettes. Texture writing
(`render_textures`) is a side effect deliberately kept out of `normalise()` — it is called
only from `main()`, per the project's `Layer.sample()`/`normalise()` purity contract
(`CLAUDE.md`, `DESIGN.md` §4/§10).

**Running the real build is one command.** `pipeline/databuild.py` calls each source's
`fetch()`, then `normalise()`, then — if the module defines it — `write_outputs(raw_dir,
repo_root)`, a hook `pipeline.databuild` looks for automatically after every rebuild. This
package's `normalise.py` defines `write_outputs` as a thin wrapper over `render_textures`,
so:

```
.venv/bin/python -m pipeline.databuild --only paleodem   # fetch + normalise -> curated parquet + write_outputs() -> textures
```

produces both the curated parquet and `data/media/textures/paleodem/*.webp` in one run.
`manifest.toml`'s `outputs = ["data/media/textures/paleodem/*.webp"]` tells databuild's
staleness check about the textures too: deleting them (with the curated parquet and stamp
otherwise untouched) makes the source stale again on the next `make data`, since a plain
curated-file check alone would report "fresh" and never regenerate them.

`sources/paleodem/normalise.py`'s own `main()` remains a manual entry point alongside (not
instead of) the automatic `databuild` path, mirroring `sources/co2-o2/normalise.py`'s
`main()` — and still assumes `data/raw/paleodem/` is already populated by `fetch()`.

## Measured volume

- Raw zip: **9,302,291 bytes** (9.3 MB, measured — matches the manifest's declared size and
  the recorded sha256 exactly). Kept in `data/raw/paleodem/` (gitignored) under its upstream
  filename, verified rather than re-downloaded on later runs — see `fetch.py`.
- Extracted raw `.nc` grids (109 files, `data/raw/paleodem/`, gitignored): ~9.7 MB total
  (individually 34-101 KB each, netCDF's own internal zlib compression already shrinks a
  261 KB raw `float32` 181x361 grid to well under that).
- Curated `data/curated/paleodem.parquet` (109 frames: `t`, `ref`) and
  `data/curated/land_fraction.parquet` (109 samples: `t`, `value`, `lower`, `upper`), both
  far under the git-tier threshold.
- Generated textures (`data/media/textures/paleodem/*.webp`): 109 files, 1024x512 RGB lossy
  WebP, **3.91 MB total** (20-70 KB each, mean 35 KB), rendered in ~4 s on an M-series Mac.
  See "Texture encoding".

## Storage tier chosen

**git** for both curated parquet files — tiny (well under the 5 MB threshold). Textures are
**generated media**, per `docs/DATA_SOURCES.md`'s storage policy ("generated media | git-lfs:
pinned images + data/media/") — written to `data/media/textures/paleodem/` and committed via
git-lfs (`.gitattributes` covers `data/media/**/*.webp`), matching how
`docs/ONESHOT_SCOPE.md` describes the MVP's media serving (`data/media/`, local dev server,
no R2/Cloudflare wiring yet). *Correction, 2026-09-17: an earlier revision of this README
claimed these textures were "gitignored, never committed" — `data/media/` itself is not
gitignored, and the storage policy calls for git-lfs here; that claim was simply wrong, not a
deliberate choice. Whether they have actually been `git add`ed in a given checkout is a
separate, unrelated fact from what tier they belong in.*

## Fixture

`sources/paleodem/fixture/` holds 2 real files — the 0 Ma and 540 Ma (oldest) grids,
re-encoded from the actually-downloaded data with `z` cast from `float32` to `int16`
(lossless here: 99.4% of cells in the real 0 Ma grid are already integer-valued metres, and
every value across all 109 epochs fits comfortably inside int16's ±32,767 range — the
global measured extreme is -9,000/+10,500) and non-essential attributes (the `history` GMT
invocation string, `GMT_version`) stripped. Filenames are preserved verbatim from the real
archive, including the literal space in the 540 Ma one
(`Map88_PALEOMAP_1deg_Cambrian_Precambrian boundary_540Ma.nc`), so the fixture exercises the
same filename-parsing path production data does. Total fixture size: ~117 KB, well under the
1 MB ceiling.

Two epochs (not all 12 target epochs) is deliberate, not an oversight — it is what makes
`_select_frame_epochs`'s graceful-degradation path testable at all (see
`tests/sources/test_paleodem.py`'s module docstring).

## No new dependencies

`xarray`, `netcdf4` (imported as `netCDF4`, used implicitly as xarray's backend),
`numpy`, `pyarrow`, and `pillow` are all already declared in `pyproject.toml` (`pillow` in
core `dependencies`, the rest in the `data` extra). Nothing new was added.
