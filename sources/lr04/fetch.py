"""Download the LR04 stack into data/raw/lr04/, verified against manifest.toml's sha256."""

from __future__ import annotations

import tomllib
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"

RAW_FILENAME = "lisiecki2005-d18o-stack-noaa.txt"


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    manifest = _load_manifest()
    url = str(manifest["url"])
    ensure_verified_artefact(raw_dir, RAW_FILENAME, str(manifest["sha256"]), lambda: _download(url))


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "lr04")
