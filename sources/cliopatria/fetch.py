"""Download raw data into data/raw/cliopatria/. Record sha256 in manifest.toml.

The Zenodo deposit is a full snapshot of the `cliopatria` GitHub repository at release
v0.0.1 -- a zip containing a `.gitignore`, `LICENSE.md`, `README.md`, a `notebooks/` folder,
and the one file this source actually needs: `cliopatria.geojson.zip`, itself a zip
containing the single real dataset file, `cliopatria.geojson` (measured 186,488,764 bytes
uncompressed -- README.md "Measured volume"). `fetch()` keeps the verified outer zip in
raw_dir under its own upstream filename (via `pipeline.fetching.ensure_verified_artefact`,
which downloads it only if missing or not verifying -- the network is never touched on a
later run whose zip is already on disk and still verifies), then extracts the nested
`cliopatria.geojson.zip` member and unzips *that* in turn to write `cliopatria.geojson`
directly into raw_dir, discarding both zips and every other repository file (`.gitignore`,
`LICENSE.md`, the notebooks) -- normalise() only ever reads `raw_dir/cliopatria.geojson`.
Extraction runs every time fetch() does (idempotent and cheap next to the download), matching
sources/paleodem/fetch.py's own precedent.
"""

from __future__ import annotations

import io
import tomllib
import zipfile
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"

_OUTER_ZIP_FILENAME = "cliopatria-v0.0.1.zip"
"""The upstream filename this source keeps the downloaded repository snapshot under in
raw_dir -- the manifest's own `url` ends `/content`, not a filename, the same situation
sources/paleodem/fetch.py documents for its own Zenodo file-content URL."""

_INNER_ZIP_MEMBER_SUFFIX = "cliopatria.geojson.zip"
_GEOJSON_MEMBER_SUFFIX = "cliopatria.geojson"
_GEOJSON_FILENAME = "cliopatria.geojson"


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
def _download(url: str) -> bytes:
    # ~47 MB plus Zenodo's own observed latency (sources/paleodem/fetch.py notes it flapping
    # with 504s) needs a generous timeout -- co2-o2's 30s default is sized for a 5 KB file.
    response = httpx.get(url, timeout=180.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _find_member(archive: zipfile.ZipFile, suffix: str) -> zipfile.ZipInfo:
    matches = [m for m in archive.infolist() if m.filename.endswith(suffix)]
    if len(matches) != 1:
        raise ValueError(
            f"expected exactly one {suffix!r} member, found {len(matches)}: "
            f"{[m.filename for m in matches]}"
        )
    return matches[0]


def _extract_geojson(outer_zip_path: Path, raw_dir: Path) -> None:
    with zipfile.ZipFile(outer_zip_path) as outer:
        inner_bytes = outer.read(_find_member(outer, _INNER_ZIP_MEMBER_SUFFIX))
    with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
        geojson_bytes = inner.read(_find_member(inner, _GEOJSON_MEMBER_SUFFIX))
    (raw_dir / _GEOJSON_FILENAME).write_bytes(geojson_bytes)


def fetch(raw_dir: Path) -> None:
    """Ensure the Zenodo Cliopatria release zip is present in raw_dir and verified against
    manifest.toml (downloading it only if needed), then (re-)extract `cliopatria.geojson`
    from its doubly-nested zip into raw_dir."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    outer_zip_path = ensure_verified_artefact(
        raw_dir, _OUTER_ZIP_FILENAME, expected_sha256, lambda: _download(url)
    )
    _extract_geojson(outer_zip_path, raw_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "cliopatria")
