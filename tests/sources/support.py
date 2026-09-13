"""Shared helpers for per-source tests.

Source directories use hyphenated names (`sources/co2-o2/`), which are not importable
packages, so tests load a source's modules by path. The by-path loader itself lives in
`pipeline.databuild` (the real `make data` build needs the same loading, not a second
copy of it); this module only resolves a source *name* to its directory, for that loader
and for `fixture_dir`.
"""

from __future__ import annotations

from pathlib import Path
from types import ModuleType

from pipeline.databuild import load_source_module as _load_source_module

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_DIR = REPO_ROOT / "sources"


def fixture_dir(source: str) -> Path:
    return SOURCES_DIR / source / "fixture"


def load_source_module(source: str, module: str) -> ModuleType:
    return _load_source_module(SOURCES_DIR / source, module)
