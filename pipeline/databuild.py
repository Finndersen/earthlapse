"""Fingerprinted rebuild runner for `sources/`. Implements the "Data build" step of
DESIGN.md §2 and the `make data` contract in DATA_SOURCES.md § Cross-cutting concerns:
"`make data` re-runs any source whose raw checksum or normaliser hash changed. A source
whose upstream URL has rotted must fail loudly, not silently serve stale data."

For each `sources/<name>/`, `build()` decides whether it needs to run again by hashing its
own code (`fingerprint`) plus any hand-curated file committed directly under `data/`
(`_shared_inputs_fingerprint` -- e.g. `data/events.yaml`, read by events-core's
`normalise.py` from outside its own source directory) rather than trusting timestamps,
runs `fetch` then `normalise` when it does, and writes the result through
`pipeline.curated.write_shape`. If `normalise.py` defines an optional `write_outputs(raw_dir,
repo_root)` function, it is called next -- the hook for a source's side-effect writes outside
`data/curated/` (e.g. paleodem's globe textures; see CONTRIBUTING.md "Optional write_outputs
hook"). A stamp at `data/raw/<name>/.databuild.json` records what was last built -- including,
for each glob `manifest.toml`'s optional `outputs` field declares, how many files it matched
-- so the next run can skip anything unchanged, and now also treats a source as stale again
if a declared output glob's on-disk files are missing or fewer than what was recorded.

One source's failure -- typically a rotted upstream URL -- is caught, recorded in the
report, and does not stop the rest of the build. `main()` then exits non-zero and lists
the failures: that non-zero exit is the "fail loudly" requirement, not a swallowed error.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import sys
import tomllib
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from types import ModuleType

from pydantic import BaseModel, Field

from pipeline.curated import write_shape

_STAMP_FILENAME = ".databuild.json"
_EXCLUDED_DIRS = frozenset({"fixture", "__pycache__"})


@dataclass(frozen=True)
class SourceDir:
    """One `sources/<name>/` directory."""

    name: str
    path: Path


def discover_sources(sources_dir: Path) -> list[SourceDir]:
    """Every `sources/<name>/` with a `manifest.toml`, excluding `_template` and any
    other directory starting with `_`."""
    return sorted(
        (
            SourceDir(name=entry.name, path=entry)
            for entry in sources_dir.iterdir()
            if entry.is_dir()
            and not entry.name.startswith("_")
            and (entry / "manifest.toml").is_file()
        ),
        key=lambda source: source.name,
    )


def load_source_module(source_dir: Path, module: str) -> ModuleType:
    """Load `<source_dir>/<module>.py` by path.

    Source directories are hyphenated (`sources/co2-o2/`), so they are not importable
    packages as-is -- this is the by-path loader every source module goes through, both
    here in the real build and in `tests/sources/support.py` (which re-exports it).
    """
    path = source_dir / f"{module}.py"
    name = f"sources_{source_dir.name.replace('-', '_')}_{module}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load source module {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _hash_files(base_dir: Path, files: Iterable[Path]) -> str:
    hasher = hashlib.sha256()
    for path in sorted(files, key=lambda path: path.relative_to(base_dir).as_posix()):
        hasher.update(path.relative_to(base_dir).as_posix().encode())
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def fingerprint(source_dir: Path) -> str:
    """sha256 over every `*.toml` and `*.py` in `source_dir`, excluding `fixture/` and
    `__pycache__`.

    This -- not `data/raw/`'s own checksum -- is what `make data` compares against the
    stamp: `data/raw/` is gitignored and reproduced by `fetch()`, so it is not a stable
    thing to fingerprint the *source* against. What changed is the manifest (a new upstream
    URL or sha256), a hand-curated input beside it (`roster.toml`, `stems.toml`), or the
    source's own code (`fetch.py`/`normalise.py`), and any of them must trigger a rebuild.
    """
    candidates = {*source_dir.rglob("*.toml"), *source_dir.rglob("*.py")}
    files = (
        path
        for path in candidates
        if path.is_file() and not _EXCLUDED_DIRS & set(path.relative_to(source_dir).parts)
    )
    return _hash_files(source_dir, files)


def _shared_inputs_fingerprint(repo_root: Path) -> str:
    """sha256 over every file committed directly under `data/` -- e.g. `data/events.yaml`,
    which DATA_SOURCES.md documents as events-core's own "source, not derived data", read
    by its `normalise.py` from outside `sources/events-core/` entirely.

    `fingerprint()` only sees a source's own directory, so a source whose normaliser reads
    a hand-curated file living directly under `data/` (rather than under its own
    `data/raw/<name>/`) would otherwise go undetected by staleness -- silently serving a
    stale curated file after that hand-curated input changes, the exact thing
    DATA_SOURCES.md's "fail loudly, not silently serve stale data" forbids. `data/raw/`
    and `data/curated/` are directories, not files, so `iterdir()` (non-recursive) already
    excludes both without needing to name them.

    `data/` itself may not exist yet on a from-scratch build (it is created as a side
    effect of the first source's own `raw_dir.mkdir`) -- that must hash the same as an
    empty, already-created `data/`, or the very act of building would make every source
    look stale again on the next run.
    """
    data_dir = repo_root / "data"
    files = (path for path in data_dir.iterdir() if path.is_file()) if data_dir.is_dir() else ()
    return _hash_files(data_dir, files)


class SourceManifest(BaseModel):
    """The subset of `manifest.toml` that `databuild.py` itself reads.

    Every other field (`url`, `sha256`, `licence`, `citation`, ...) is consumed by a
    source's own `fetch.py`/`normalise.py`, not by the build runner, so this model does not
    mirror the full schema documented in `docs/DATA_SOURCES.md` § Contract -- pydantic's
    default "ignore unknown fields" behaviour means it never needs updating when a source
    adds a field only it cares about.
    """

    outputs: list[str] = Field(default_factory=list)
    """Repo-relative glob patterns (see `sources/_template/manifest.toml`) for side-effect
    files a source's optional `write_outputs()` hook writes outside `data/curated/` -- e.g.
    paleodem's globe textures under `data/media/textures/paleodem/`. Most sources declare
    none."""


def _load_manifest(source_dir: Path) -> SourceManifest:
    with (source_dir / "manifest.toml").open("rb") as f:
        return SourceManifest.model_validate(tomllib.load(f))


def _match_output_glob(repo_root: Path, pattern: str) -> list[Path]:
    return sorted(repo_root.glob(pattern))


class OutputStamp(BaseModel):
    """How many files one declared `outputs` glob matched, as recorded at build time."""

    pattern: str
    count: int


def _current_output_stamps(repo_root: Path, patterns: list[str]) -> list[OutputStamp]:
    return [
        OutputStamp(pattern=pattern, count=len(_match_output_glob(repo_root, pattern)))
        for pattern in patterns
    ]


class BuildStamp(BaseModel):
    """Recorded at `data/raw/<name>/.databuild.json` after a successful build."""

    fingerprint: str
    curated_ids: list[str]
    outputs: list[OutputStamp] = Field(default_factory=list)


def _stamp_path(raw_dir: Path) -> Path:
    return raw_dir / _STAMP_FILENAME


def _load_stamp(raw_dir: Path) -> BuildStamp | None:
    path = _stamp_path(raw_dir)
    if not path.is_file():
        return None
    return BuildStamp.model_validate_json(path.read_text())


def _write_stamp(raw_dir: Path, stamp: BuildStamp) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    _stamp_path(raw_dir).write_text(stamp.model_dump_json(indent=2) + "\n")


def _outputs_are_stale(repo_root: Path, recorded: list[OutputStamp]) -> bool:
    """True if any declared output glob now matches nothing, or matches fewer files than
    the stamp recorded last time it was built -- e.g. paleodem's textures were deleted, or
    partially deleted, out from under an otherwise-fresh curated build."""
    return any(
        (current := len(_match_output_glob(repo_root, output.pattern))) == 0
        or current < output.count
        for output in recorded
    )


def _is_stale(raw_dir: Path, curated_dir: Path, repo_root: Path, current_fingerprint: str) -> bool:
    """A source is stale if it has never been built, its fingerprint has drifted since
    the last successful build, a curated file that build recorded is now missing, or a
    declared output glob (`manifest.toml`'s `outputs`) no longer matches what was recorded."""
    stamp = _load_stamp(raw_dir)
    if stamp is None or stamp.fingerprint != current_fingerprint:
        return True
    if any(not (curated_dir / f"{cid}.parquet").is_file() for cid in stamp.curated_ids):
        return True
    return _outputs_are_stale(repo_root, stamp.outputs)


class BuildStatus(StrEnum):
    FRESH = "fresh"
    REBUILT = "rebuilt"
    FAILED = "failed"


@dataclass(frozen=True)
class SourceResult:
    name: str
    status: BuildStatus
    curated_ids: tuple[str, ...] = ()
    error: str | None = None


@dataclass(frozen=True)
class BuildReport:
    results: tuple[SourceResult, ...]

    @property
    def failures(self) -> tuple[SourceResult, ...]:
        return tuple(r for r in self.results if r.status is BuildStatus.FAILED)

    @property
    def exit_code(self) -> int:
        return 1 if self.failures else 0


def _build_one(
    source: SourceDir,
    raw_dir: Path,
    curated_dir: Path,
    repo_root: Path,
    manifest: SourceManifest,
    current_fingerprint: str,
) -> SourceResult:
    # Deliberately broad: this is a batch runner over independent sources, and one
    # source's exception (typically a rotted upstream URL) must be recorded and reported
    # rather than aborting every other source's build. Nothing here is swallowed -- the
    # exception text always ends up in the report and, via main()'s exit code, "fails
    # loudly" per DATA_SOURCES.md rather than serving stale data quietly.
    try:
        fetch_module = load_source_module(source.path, "fetch")
        normalise_module = load_source_module(source.path, "normalise")
        fetch_module.fetch(raw_dir)
        shapes = normalise_module.normalise(raw_dir)
        curated_ids = []
        for shape in shapes:
            write_shape(shape, curated_dir)
            curated_ids.append(shape.id)
        write_outputs = getattr(normalise_module, "write_outputs", None)
        if write_outputs is not None:
            write_outputs(raw_dir, repo_root)
        outputs = _current_output_stamps(repo_root, manifest.outputs)
        _write_stamp(
            raw_dir,
            BuildStamp(fingerprint=current_fingerprint, curated_ids=curated_ids, outputs=outputs),
        )
    except Exception as exc:  # noqa: BLE001 -- one source's failure must be reported, not abort the build
        return SourceResult(
            name=source.name,
            status=BuildStatus.FAILED,
            error=f"{type(exc).__name__}: {exc}",
        )
    return SourceResult(
        name=source.name, status=BuildStatus.REBUILT, curated_ids=tuple(curated_ids)
    )


def build(repo_root: Path, only: set[str] | None = None, force: bool = False) -> BuildReport:
    """Rebuild every stale source under `repo_root/sources` into `repo_root/data/curated`.

    `only` restricts the run to those source names, raising `ValueError` if one is
    unknown. `force` rebuilds every selected source regardless of staleness.
    """
    sources_dir = repo_root / "sources"
    curated_dir = repo_root / "data" / "curated"
    raw_root = repo_root / "data" / "raw"

    sources = discover_sources(sources_dir)
    if only is not None:
        known = {source.name for source in sources}
        unknown = only - known
        if unknown:
            raise ValueError(f"unknown source(s): {', '.join(sorted(unknown))}")
        sources = [source for source in sources if source.name in only]

    shared_fingerprint = _shared_inputs_fingerprint(repo_root)
    results: list[SourceResult] = []
    for source in sources:
        raw_dir = raw_root / source.name
        manifest = _load_manifest(source.path)
        current_fingerprint = hashlib.sha256(
            f"{fingerprint(source.path)}\0{shared_fingerprint}".encode()
        ).hexdigest()
        if not force and not _is_stale(raw_dir, curated_dir, repo_root, current_fingerprint):
            results.append(SourceResult(name=source.name, status=BuildStatus.FRESH))
            continue
        results.append(
            _build_one(source, raw_dir, curated_dir, repo_root, manifest, current_fingerprint)
        )
    return BuildReport(results=tuple(results))


def _format_result(result: SourceResult) -> str:
    match result.status:
        case BuildStatus.FRESH:
            return f"{result.name}: fresh"
        case BuildStatus.REBUILT:
            ids = ", ".join(result.curated_ids) if result.curated_ids else "no shapes"
            return f"{result.name}: rebuilt ({ids})"
        case BuildStatus.FAILED:
            return f"{result.name}: FAILED -- {result.error}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild stale sources/ into data/curated/.")
    parser.add_argument(
        "--only", action="append", metavar="NAME", help="restrict to this source (repeatable)"
    )
    parser.add_argument(
        "--force", action="store_true", help="rebuild every selected source regardless of staleness"
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    try:
        report = build(repo_root, only=set(args.only) if args.only else None, force=args.force)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    for result in report.results:
        print(_format_result(result))
    if report.failures:
        names = ", ".join(result.name for result in report.failures)
        print(f"\n{len(report.failures)} source(s) failed: {names}", file=sys.stderr)
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
