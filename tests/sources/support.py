"""Shared helpers for per-source tests.

Source directories use hyphenated names (`sources/co2-o2/`), which are not importable
packages, so tests load a source's modules by path.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_DIR = REPO_ROOT / "sources"


def fixture_dir(source: str) -> Path:
    return SOURCES_DIR / source / "fixture"


def load_source_module(source: str, module: str) -> ModuleType:
    path = SOURCES_DIR / source / f"{module}.py"
    name = f"sources_{source.replace('-', '_')}_{module}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load source module {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
