"""Download raw data into data/raw/globe-regimes/. Record sha256 in manifest.toml.

No-op for this source, exactly like sources/astronomy/fetch.py and for the same reason.
globe-regimes is hand-curated: data/globe_regimes.yaml already carries a specific citation
per regime, cross-checked by hand against the primary literature (see README.md). There is
no upstream file to download, verify, or cache in data/raw/ -- this function exists only so
globe-regimes behaves like every other source under `make data` / earthlapse's fetch dispatch.
"""

from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    """No-op: see module docstring. `raw_dir` is accepted, unused, and never created."""


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "globe-regimes")
