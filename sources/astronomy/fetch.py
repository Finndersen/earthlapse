"""Download raw data into data/raw/astronomy/. Record sha256 in manifest.toml.

No-op for this source. `astronomy` is "computed, not sourced" (docs/DATA_SOURCES.md
Tier 3): day length, lunar distance, solar luminosity and obliquity are each either a
closed-form formula or a handful of cited published point estimates, hard-coded with
their citations directly in normalise.py. There is nothing to download, verify, or
cache in data/raw/ -- the function signature is kept only so `astronomy` behaves like
every other source under `make data` / earthlapse's fetch dispatch.
"""

from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    """No-op: see module docstring. `raw_dir` is accepted, unused, and never created."""


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "astronomy")
