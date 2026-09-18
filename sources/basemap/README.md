# Source: basemap

Natural Earth II ("with Shaded Relief, Water, and Drainages", 1:10m) — the human-era globe
base texture, replacing the PaleoDEM reconstruction for the recent past, where continental
drift is imperceptible (ADR-030). `RasterSequence` × 2 (`basemap_t0`, `basemap_t1` — one per
resolution tier, see "Why two curated ids" below).

## Licence — confirmed at fetch time

`https://www.naturalearthdata.com/about/terms-of-use/`, fetched live: **"All versions of
*Natural Earth* raster + vector map data found on this website are in the public domain.
... No permission is needed to use *Natural Earth*."** No attribution is legally required,
but the manifest credits it anyway per project convention (`manifest.toml`'s `citation`).

## What was and wasn't downloaded

The download page (`.../downloads/10m-raster-data/10m-natural-earth-2/`) lists a "Large"
(HR, ~310 MB reported / 325,795,333 bytes measured) and "Medium" (LR, ~185 MB reported /
**194,338,220 bytes measured**) zip. **The page's own download links are broken** — they
resolve to `naturalearthdata.com/http//naturalearthdata.com/download/10m/raster/...` (a
template bug: the relative path already starts with a scheme-relative URL and the site
prepends its own origin again), confirmed by a live 404/500. The real files live on Natural
Earth's CDN, `naciscdn.org` (`https://naciscdn.org/naturalearth/10m/raster/<file>.zip`),
which is where naturalearthdata.com's own links land for every *other* asset on the site —
used directly here instead of the broken page link.

Only the **LR** ("low resolution", `NE2_LR_LC_SR_W_DR.zip`) variant is fetched. Its one
GeoTIFF is **16200×8100** pixels — comfortably more than our largest published tier (T1,
4096×2048), so the HR variant (a larger multiple of the same content) buys nothing. Zip
contents: `NE2_LR_LC_SR_W_DR.tif` (393,768,556 bytes uncompressed), a `.tfw` worldfile, a
`.prj` (plain geographic WGS84, no named EPSG code — `GEOGCS["GCS_WGS_1984", ...]`), a
`.README.html` and a `.VERSION.txt`. `fetch.py` extracts only the `.tif`.

## Schema

Plain equirectangular, node-adjacent (pixel-is-area) grid, confirmed from the `.tfw`
worldfile: pixel size 0.022222° (= 1/45°, i.e. 45 px/degree — 16200/360 = 45 exactly),
top-left origin at (-179.98889°, 89.98889°) — i.e. **pixel-centred**, not the
node-registered (`-180` exactly) convention `sources/paleodem` uses. 16200×8100 is exactly
2:1, so no reprojection or cropping is needed before resizing. RGB, 8-bit.

## Why two curated ids, not a "tier" field

`RasterSequence` (one of the four NORMATIVE curated shapes, DATA_SOURCES.md § Contract) has
no notion of "resolution tier" — each frame is one `t` → one `ref`. Adding a tier field would
be a shape change, which needs an ADR (CLAUDE.md). Natural Earth II is not time-varying data
in the first place (unlike `sources/hyde`'s 73 real timesteps), so this source publishes
**two independent `RasterSequence`s**, `basemap_t0` (2048×1024) and `basemap_t1`
(4096×2048) — the same pattern `sources/paleodem` and `sources/plates-neoproterozoic` already
use for two different *time* domains of a similar kind of data, reused here for two
*resolution* domains instead. A caller picks a tier by id, exactly as GLOBE.md §3.4 already
describes for selecting a raster layer by id in `buildLayers.ts`.

T0 is for the minimised globe orb (all devices) and the expanded view on a phone; T1 for the
expanded view on desktop. Tier *selection* by device/zoom is a web-side concern
(`web/src/globe/deviceTier.ts`'s `selectBasemapTier`), not this source's own — see
`docs/GLOBE.md` §10.

## Why two frames per tier ("Why two frames")

Each tier's `RasterSequence` has exactly two frames, both referencing the *same* texture
file: `t=0` (present) and `t=PLEISTOCENE_START` (2,580,000 years BP —
`normalise.py`'s own named constant). `RasterSequence.sample(t)` requires
`frames[0].t <= t <= frames[-1].t`; a single frame would collapse the domain to one instant,
which is useless for a texture that is valid across a whole span. Two identical-ref frames
give the sequence a genuine `[0, 2580000]` domain at zero extra storage cost (the ref string
is duplicated, not the image).

## Time domain vs. the crossfade window

**These are deliberately two different numbers, not one.** The published `RasterSequence`
domain (`[0, PLEISTOCENE_START]` = `[0, 2580000]`) is *informational*: how far back the base
is presented as roughly geographically correct, pinned to a citable, independently-justified
geological boundary (the Gelasian/Quaternary-Pleistocene boundary, ICS International
Chronostratigraphic Chart — the same authority DESIGN.md §3's era sections already cite).

The *product's* actual paleodem → basemap crossfade is a **separate, narrower band, fixed
directly by the user at "roughly 400 → 300 ka (before H. sapiens dispersal overlays
start)"**. It is not read from this domain at all: the established precedent for a raster
crossfade boundary in this codebase (`web/src/globe/blend.ts`'s `SEAM_BAND`, the 540–550 Ma
paleodem/plates-neoproterozoic seam, docs/GLOBE.md §4.1) is a plain constant on the web side,
not manifest data — `paleodem` itself is published with its full, un-truncated domain
(`[0, 5.4e8]`) even though its *effective* contribution stops mattering once `basemap` takes
over; this source follows the same split rather than smuggling the crossfade's own arbitrary
edge into the published data as if it were a property of the imagery. The web-side crossfade
is built: `web/src/globe/blend.ts`'s `BASEMAP_CROSSFADE_BAND = [300_000, 400_000]`, alongside
`SEAM_BAND` — see `docs/GLOBE.md` §10.

## Texture encoding

Lossy WebP, quality 90 — matching `sources/paleodem`'s own choice and rationale (this is
imagery, not a data layer, so CONTRIBUTING.md's higher bar for data layers doesn't apply).
Measured, both tiers together:

| Tier | Size | Encoding | Bytes |
|---|---|---|---|
| `basemap_t0` | 2048×1024 | WebP q90 | 335,054 (327 KB) |
| `basemap_t1` | 4096×2048 | WebP q90 | 1,376,076 (1.34 MB) |

Resized with Lanczos resampling (`PIL.Image.Resampling.LANCZOS`) from the 16200×8100 source —
a ~7.9× downsample for T0 and ~4× for T1, both well inside what Lanczos handles cleanly (no
visible ringing at these ratios on a photographic/cartographic image).

## Measured volume

- Raw zip: **194,338,220 bytes** (194.3 MB, measured — matches manifest.toml's declared size
  and sha256). Kept in `data/raw/basemap/` (gitignored), verified rather than re-downloaded on
  later runs.
- Extracted raw `.tif`: 393,768,556 bytes (~394 MB, gitignored).
- Curated `data/curated/basemap_t0.parquet` and `basemap_t1.parquet`: 2 frames each, far under
  the git-tier threshold.
- Generated textures (`data/media/textures/basemap/*.webp`): **1.71 MB total** (327 KB +
  1.34 MB) — see "Texture encoding" above.

## Storage tier chosen

**git** for both curated parquet files (tiny). Textures are generated media, written to
`data/media/textures/basemap/` and committed via git-lfs — `.gitattributes` already covers
`data/media/**/*.webp`, and `data/media/` itself is not gitignored (only `data/raw/` and
`data/candidates/` are) — matching `docs/DATA_SOURCES.md`'s storage policy ("generated media
| git-lfs: pinned images + data/media/") and `sources/paleodem`'s own convention.

## Fixture

`sources/basemap/fixture/NE2_LR_LC_SR_W_DR.tif` is the real downloaded GeoTIFF, resized
(Lanczos, real pixel data — not synthetic) down to 64×32 — small enough to commit (6.3 KB)
while exercising the same `normalise()`/`render_textures()` code path production data does
(single-file discovery, both-tier rendering). Real dimensions (16200×8100) are not asserted
anywhere in `normalise.py`, so the smaller fixture needs no special-casing.

## No new dependencies

`pillow` is already a core dependency (`pyproject.toml`). Nothing new was added.
