"""Normalise data/raw/basemap/ into two RasterSequences: "basemap_t0" and "basemap_t1".

Natural Earth II is a single, temporally-flat raster (no per-epoch data -- see
docs/DATA_SOURCES.md's `hyde`/`basemap` entries and README.md "Why two frames"), unlike
sources/paleodem's 109 real epochs. It is published as **two resolution tiers**, not two
points in time: `RasterSequence` has no "tier" concept (DESIGN.md's four curated shapes are
NORMATIVE -- adding one needs an ADR), so each tier is its own curated id, exactly the way
sources/paleodem and sources/plates-neoproterozoic are two different ids for two different
*time* domains of the same kind of data. `id="basemap_t0"` is 2048x1024 (the globe orb on
every device, and the expanded view on a phone); `id="basemap_t1"` is 4096x2048 (the expanded
view on desktop). Callers pick a tier by id -- the same pattern GLOBE.md §3.4 already
describes for `buildLayers.ts` selecting a raster layer by id.

Each tier's `RasterSequence` carries exactly two frames, at `t=0` (present) and
`t=PLEISTOCENE_START`, both referencing the *same* texture file -- see "Why two frames" below.
This domain is informational (how far back the base is presented as roughly geographically
correct), not the actual product crossfade boundary: see `PLEISTOCENE_START`'s own docstring
and README.md "Time domain vs. the crossfade window" for why the two are deliberately not the
same number.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from pipeline.curated import write_shape
from pipeline.shapes import CuratedShape, RasterFrame, RasterSequence

Image.MAX_IMAGE_PIXELS = None
"""The source GeoTIFF is 16200x8100 (~131M pixels), over PIL's default 89M decompression-bomb
threshold. It's a known, sha256-pinned file from a trusted source, not untrusted input."""

PLEISTOCENE_START: float = 2_580_000.0
"""Years BP -- the Gelasian/Quaternary-Pleistocene boundary (ICS International
Chronostratigraphic Chart, the same authority DESIGN.md §3's era sections cite), the
published, citable point past which continental positions are essentially today's: this
source's own domain, `[0, PLEISTOCENE_START]`, is deliberately **not** the same number as the
product's actual paleodem -> basemap crossfade band (300 -> 400 ka, fixed directly by the
user, ADR-030). That band lives entirely on the web side (`BASEMAP_CROSSFADE_BAND`,
`web/src/globe/blend.ts`, the same pattern `SEAM_BAND` already uses for the paleodem/
plates-neoproterozoic seam) and never reads this domain -- so this constant is free to be
picked on its own, independently justifiable terms (a real geological boundary) rather than
smuggling the crossfade's own arbitrary edge into published data as if it were a property of
the imagery. See README.md "Time domain vs. the crossfade window"."""

TIER_T0 = "basemap_t0"
TIER_T1 = "basemap_t1"

TIER_SIZES: dict[str, tuple[int, int]] = {
    TIER_T0: (2048, 1024),  # orb (all devices) and expanded (phone)
    TIER_T1: (4096, 2048),  # expanded (desktop only)
}

TEXTURE_EXTENSION = ".webp"
TEXTURE_WEBP_QUALITY = 90
"""Lossy WebP, matching sources/paleodem's own choice for globe base textures (README.md
"Texture encoding") -- this is imagery, not a data layer, so the higher bar
CONTRIBUTING.md sets for data layers doesn't apply."""

_TEXTURE_SUBDIR = Path("textures") / "basemap"


class MissingRawFileError(FileNotFoundError):
    """raw_dir has no extracted .tif -- run fetch() first."""


def _discover_raw_tif(raw_dir: Path) -> Path:
    matches = sorted(raw_dir.glob("*.tif"))
    if not matches:
        raise MissingRawFileError(f"basemap: no .tif found in {raw_dir} -- run fetch() first")
    if len(matches) > 1:
        raise MissingRawFileError(
            f"basemap: {len(matches)} .tif files found in {raw_dir}, expected exactly 1: "
            f"{[p.name for p in matches]}"
        )
    return matches[0]


def _tier_ref(tier: str) -> str:
    return (_TEXTURE_SUBDIR / f"{tier}{TEXTURE_EXTENSION}").as_posix()


def _tier_sequence(tier: str) -> RasterSequence:
    ref = _tier_ref(tier)
    return RasterSequence(
        id=tier,
        frames=[
            RasterFrame(t=0.0, ref=ref),
            RasterFrame(t=PLEISTOCENE_START, ref=ref),
        ],
    )


def normalise(raw_dir: Path) -> list[CuratedShape]:
    """Both tiers exist unconditionally once fetch() has run -- there's no "epoch discovery"
    step the way sources/paleodem has (this source is a single flat image), so unlike that
    source this only needs to confirm the raw .tif is present, not open it."""
    _discover_raw_tif(raw_dir)
    return [_tier_sequence(TIER_T0), _tier_sequence(TIER_T1)]


def _render_tile(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.LANCZOS)


def render_textures(raw_dir: Path, media_dir: Path) -> None:
    """Write both tiers' WebP textures into media_dir/textures/basemap/, and remove any other
    file there. A side effect, deliberately kept out of normalise() (DESIGN.md's purity
    contract, project CLAUDE.md)."""
    tif_path = _discover_raw_tif(raw_dir)
    out_dir = media_dir / _TEXTURE_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = {f"{tier}{TEXTURE_EXTENSION}" for tier in TIER_SIZES}
    for existing in out_dir.iterdir():
        if existing.is_file() and existing.name not in expected:
            existing.unlink()
    with Image.open(tif_path) as source:
        source.load()
        source_rgb = source.convert("RGB")
        for tier, size in TIER_SIZES.items():
            tile = _render_tile(source_rgb, size)
            tile.save(
                out_dir / f"{tier}{TEXTURE_EXTENSION}",
                "WEBP",
                quality=TEXTURE_WEBP_QUALITY,
                method=6,
            )


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    """`databuild`'s optional post-normalise side-effect hook (CONTRIBUTING.md "Optional
    write_outputs hook"). Thin wrapper over `render_textures`, matching
    sources/paleodem/normalise.py's own `write_outputs`."""
    render_textures(raw_dir, repo_root / "data" / "media")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    raw_dir = repo_root / "data" / "raw" / "basemap"
    for shape in normalise(raw_dir):
        path = write_shape(shape, repo_root / "data" / "curated")
        print(f"wrote {path}")
    write_outputs(raw_dir, repo_root)
    print(f"wrote textures to {repo_root / 'data' / 'media' / _TEXTURE_SUBDIR}")


if __name__ == "__main__":
    main()
