"""Download raw data into data/raw/basemap/. Record sha256 in manifest.toml.

The upstream file is a zip containing one GeoTIFF (16200x8100, equirectangular WGS84) plus a
worldfile, projection file, README and version stamp. fetch() keeps the verified zip in
raw_dir (via `pipeline.fetching.ensure_verified_artefact`), then extracts only the `.tif`
member directly into raw_dir -- normalise() only ever globs `raw_dir/*.tif`. Extraction runs
every time fetch() does (idempotent and cheap next to the download), mirroring
sources/paleodem/fetch.py.
"""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"

_ZIP_FILENAME = "NE2_LR_LC_SR_W_DR.zip"


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
def _download(url: str) -> bytes:
    # ~185 MB, so a generous timeout -- co2-o2's 30s default is sized for a 5 KB file.
    response = httpx.get(url, timeout=180.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _extract_tif(zip_path: Path, raw_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            name = Path(member.filename).name
            if not name.endswith(".tif"):
                continue  # skip the README, .prj, .tfw and version stamp
            (raw_dir / name).write_bytes(archive.read(member))


def fetch(raw_dir: Path) -> None:
    """Ensure the Natural Earth II zip is present in raw_dir and verified against
    manifest.toml (downloading it only if needed), then (re-)extract its one GeoTIFF into
    raw_dir."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    zip_path = ensure_verified_artefact(
        raw_dir, _ZIP_FILENAME, expected_sha256, lambda: _download(url)
    )
    _extract_tif(zip_path, raw_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "basemap")
