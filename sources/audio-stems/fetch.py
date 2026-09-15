"""Download every catalogued stem's raw file into data/raw/audio-stems/.

Unlike a single-artifact source (`sources/co2-o2/fetch.py`), this source bundles several
independently-sourced files, one per `[[stems]]` entry in `stems.toml` (ADR-023,
`pipeline.audio.StemBook`) -- so `fetch()` loops `ensure_verified_artefact` once per stem
instead of once for the whole source. An empty `stems.toml` (nothing sourced yet) makes this
a no-op, not a failure -- see `pipeline/audio.py` `load_stem_book`.
"""

from __future__ import annotations

from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.audio import load_stem_book
from pipeline.fetching import ensure_verified_artefact

_STEMS_TOML = Path(__file__).resolve().parent / "stems.toml"
# Wikimedia's upload servers answer 403 to clients without a descriptive User-Agent
# (https://meta.wikimedia.org/wiki/User-Agent_policy); Freesound's CDN accepts it too.
_USER_AGENT = "earthview-audio-stems/2 (https://github.com/finndersen/earthview)"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def _download(url: str) -> bytes:
    response = httpx.get(
        url, timeout=30.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
    )
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    """Ensure every catalogued stem's raw file is present in raw_dir and verified against its
    own recorded sha256, downloading only the ones missing or that don't verify."""
    book = load_stem_book(_STEMS_TOML)
    for stem in book.stems:
        ensure_verified_artefact(
            raw_dir, stem.raw_filename, stem.sha256, lambda url=stem.url: _download(url)
        )


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "audio-stems")
