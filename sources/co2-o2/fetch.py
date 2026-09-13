"""Download raw data into data/raw/co2-o2/. Record sha256 in manifest.toml."""

from __future__ import annotations

import hashlib
import tomllib
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"
_RAW_FILENAME = "phanerozoic_co2.txt"


class FetchIntegrityError(RuntimeError):
    """Downloaded bytes did not match the sha256 recorded in manifest.toml."""


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    """Download the NOAA GEOCARB III phanerozoic CO2 file into raw_dir, verifying sha256
    against the value recorded in manifest.toml."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    content = _download(url)
    digest = hashlib.sha256(content).hexdigest()
    if digest != expected_sha256:
        raise FetchIntegrityError(
            f"{url}: sha256 mismatch — expected {expected_sha256}, got {digest}"
        )
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / _RAW_FILENAME).write_bytes(content)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "co2-o2")
