"""Offline tests for pipeline.databuild, against a fake sources/ tree under tmp_path --
no network, no real sources/ or data/ directories touched.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.databuild import BuildReport, BuildStatus, build, discover_sources, fingerprint

_FETCH_TEMPLATE = """\
from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "value.txt").write_text("{value}")
"""

_FAILING_FETCH = """\
from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    raise RuntimeError("upstream unreachable")
"""

_NORMALISE_TEMPLATE = """\
from __future__ import annotations

from pathlib import Path

from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries


def normalise(raw_dir: Path) -> list[CuratedShape]:
    value = float((raw_dir / "value.txt").read_text())
    return [
        TimeSeries(
            id={id!r},
            unit="u",
            interpolation=Interpolation.LINEAR,
            samples=[Sample(t=0.0, value=value)],
        )
    ]
"""

_MANIFEST_TEMPLATE = """\
name = "{name}"
url = ""
sha256 = ""
licence = "test"
citation = "test"
time_domain = [0, 0]
output_shape = "TimeSeries"
interpolation = "linear"
volume_bytes = 0
storage_tier = "git"
"""


def _write_source(
    sources_dir: Path, name: str, *, value: float = 1.0, fetch_body: str | None = None
) -> None:
    source_dir = sources_dir / name
    source_dir.mkdir(parents=True)
    (source_dir / "manifest.toml").write_text(_MANIFEST_TEMPLATE.format(name=name))
    (source_dir / "fetch.py").write_text(fetch_body or _FETCH_TEMPLATE.format(value=value))
    (source_dir / "normalise.py").write_text(_NORMALISE_TEMPLATE.format(id=name))


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """Two tiny, independent sources: alpha and beta."""
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    _write_source(sources_dir, "alpha", value=1.0)
    _write_source(sources_dir, "beta", value=2.0)
    return tmp_path


def _statuses(report: BuildReport) -> dict[str, BuildStatus]:
    return {result.name: result.status for result in report.results}


# ------------------------------------------------------------------------------- build


def test_first_build_rebuilds_all_sources_and_writes_curated_files_and_stamps(repo: Path) -> None:
    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}
    assert report.exit_code == 0
    assert (repo / "data" / "curated" / "alpha.parquet").is_file()
    assert (repo / "data" / "curated" / "beta.parquet").is_file()
    assert (repo / "data" / "raw" / "alpha" / ".databuild.json").is_file()
    assert (repo / "data" / "raw" / "beta" / ".databuild.json").is_file()


def test_second_build_reports_both_fresh(repo: Path) -> None:
    build(repo)

    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.FRESH, "beta": BuildStatus.FRESH}
    assert report.exit_code == 0


def test_editing_one_normalise_makes_only_that_source_stale(repo: Path) -> None:
    build(repo)
    normalise_path = repo / "sources" / "alpha" / "normalise.py"
    normalise_path.write_text(normalise_path.read_text() + "\n# a harmless edit\n")

    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.FRESH}


def test_editing_a_shared_data_file_makes_every_source_stale(repo: Path) -> None:
    """`data/events.yaml`-style hand-curated files -- committed directly under `data/`,
    not `data/raw/` or `data/curated/`, and read by a source's normalise.py from outside
    its own sources/<name>/ directory entirely (see events-core's normalise.py) -- are not
    covered by `fingerprint()`, which only sees a source's own directory. `build()` folds
    them into every source's fingerprint so editing one is never silently invisible."""
    build(repo)
    shared = repo / "data" / "manual.yaml"
    shared.write_text("v1\n")

    report_after_adding = build(repo)
    assert _statuses(report_after_adding) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}

    report_settled = build(repo)
    assert _statuses(report_settled) == {"alpha": BuildStatus.FRESH, "beta": BuildStatus.FRESH}

    shared.write_text("v2\n")
    report_after_editing = build(repo)
    assert _statuses(report_after_editing) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}


def test_deleting_a_curated_file_makes_its_source_stale(repo: Path) -> None:
    build(repo)
    (repo / "data" / "curated" / "beta.parquet").unlink()

    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.FRESH, "beta": BuildStatus.REBUILT}


def test_a_failing_fetch_is_reported_while_the_other_source_still_builds(tmp_path: Path) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    _write_source(sources_dir, "alpha", value=1.0)
    _write_source(sources_dir, "beta", fetch_body=_FAILING_FETCH)

    report = build(tmp_path)

    results_by_name = {result.name: result for result in report.results}
    assert results_by_name["alpha"].status is BuildStatus.REBUILT
    assert results_by_name["beta"].status is BuildStatus.FAILED
    assert "upstream unreachable" in (results_by_name["beta"].error or "")
    assert report.exit_code != 0
    assert (tmp_path / "data" / "curated" / "alpha.parquet").is_file()
    assert not (tmp_path / "data" / "curated" / "beta.parquet").exists()


def test_only_restricts_the_run_to_the_named_sources(repo: Path) -> None:
    report = build(repo, only={"alpha"})

    assert [result.name for result in report.results] == ["alpha"]
    assert (repo / "data" / "curated" / "alpha.parquet").is_file()
    assert not (repo / "data" / "curated" / "beta.parquet").exists()


def test_only_with_an_unknown_source_name_raises(repo: Path) -> None:
    with pytest.raises(ValueError, match="ghost"):
        build(repo, only={"ghost"})


def test_force_rebuilds_a_source_that_would_otherwise_be_fresh(repo: Path) -> None:
    first = build(repo)
    assert _statuses(first) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}

    report = build(repo, force=True)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}


# ------------------------------------------------------------------------ discover_sources


def test_discover_sources_excludes_directories_without_a_manifest_and_underscore_prefixed(
    tmp_path: Path,
) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    _write_source(sources_dir, "alpha")
    (sources_dir / "_template").mkdir()
    (sources_dir / "_template" / "manifest.toml").write_text("name = \"_template\"\n")
    (sources_dir / "not_a_source").mkdir()  # no manifest.toml

    found = discover_sources(sources_dir)

    assert [source.name for source in found] == ["alpha"]


# -------------------------------------------------------------------------------- fingerprint


def test_fingerprint_changes_when_a_py_file_changes(repo: Path) -> None:
    source_dir = repo / "sources" / "alpha"
    before = fingerprint(source_dir)

    (source_dir / "normalise.py").write_text(
        (source_dir / "normalise.py").read_text() + "\n# edited\n"
    )

    assert fingerprint(source_dir) != before


def test_fingerprint_changes_when_the_manifest_changes(repo: Path) -> None:
    source_dir = repo / "sources" / "alpha"
    before = fingerprint(source_dir)

    (source_dir / "manifest.toml").write_text(
        (source_dir / "manifest.toml").read_text() + "\nextra = true\n"
    )

    assert fingerprint(source_dir) != before


def test_fingerprint_ignores_fixture_contents(repo: Path) -> None:
    source_dir = repo / "sources" / "alpha"
    before = fingerprint(source_dir)

    fixture_dir = source_dir / "fixture"
    fixture_dir.mkdir()
    (fixture_dir / "ignored.py").write_text("SHOULD_NOT_AFFECT_FINGERPRINT = True\n")

    assert fingerprint(source_dir) == before
