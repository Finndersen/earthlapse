"""Shared "download-or-reuse verified artefact" logic for `sources/<name>/fetch.py`.

Every source that downloads a single upstream file follows the same shape: keep the raw
download in `data/raw/<name>/` under its own filename, verify it against the sha256 recorded
in `manifest.toml`, and skip the network entirely on a later run if that file is already
present on disk and still verifies. That reuse path matters because upstream hosts (Zenodo,
observed flapping with 504s) are not always reachable, and a source needing to rebuild for an
unrelated reason (e.g. `normalise.py` changed) must not fail just because its raw artefact,
already verified on disk, gets re-downloaded needlessly. A mismatch -- corrupt bytes on disk,
or a fresh download that doesn't match `manifest.toml` -- always raises rather than being
kept or silently retried forever.

`ensure_verified_artefact` is the one place this logic lives; every `fetch.py` that downloads
something calls it instead of reimplementing the check (see `sources/co2-o2/fetch.py`,
`sources/paleodem/fetch.py`, `sources/events-core/fetch.py`).
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from pathlib import Path


class FetchIntegrityError(RuntimeError):
    """Bytes on disk, or freshly downloaded, did not match the expected sha256."""


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def ensure_verified_artefact(
    raw_dir: Path,
    filename: str,
    expected_sha256: str,
    download: Callable[[], bytes],
) -> Path:
    """Return `raw_dir/filename`, its bytes verified against `expected_sha256`.

    If the file already exists and its sha256 matches, `download` is never called -- this is
    the network-skipping path a stale or unreachable upstream must not block. Otherwise
    `download()` is called exactly once, its result is verified (raising
    `FetchIntegrityError` on a mismatch -- unverified bytes are never written to disk) and
    written to `raw_dir/filename`.
    """
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / filename
    if target.is_file() and _sha256(target.read_bytes()) == expected_sha256:
        return target
    content = download()
    digest = _sha256(content)
    if digest != expected_sha256:
        raise FetchIntegrityError(
            f"{filename}: sha256 mismatch -- expected {expected_sha256}, got {digest}"
        )
    target.write_bytes(content)
    return target
