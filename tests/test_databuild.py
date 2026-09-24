"""pipeline.databuild against a fake sources/ tree under tmp_path."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.databuild import BuildReport, BuildStatus, build

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

_MANIFEST_WITH_OUTPUTS_TEMPLATE = _MANIFEST_TEMPLATE + 'outputs = ["outputs/{name}/*.txt"]\n'

_NORMALISE_WITH_WRITE_OUTPUTS_TEMPLATE = """\
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


def write_outputs(raw_dir: Path, repo_root: Path) -> None:
    out_dir = repo_root / "outputs" / {id!r}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "epoch.txt").write_text("rendered")
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


def test_a_rebuild_is_fresh_until_forced(repo: Path) -> None:
    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}
    assert report.exit_code == 0
    assert (repo / "data" / "curated" / "alpha.parquet").is_file()
    assert (repo / "data" / "curated" / "beta.parquet").is_file()
    assert (repo / "data" / "raw" / "alpha" / ".databuild.json").is_file()
    assert (repo / "data" / "raw" / "beta" / ".databuild.json").is_file()

    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.FRESH, "beta": BuildStatus.FRESH}
    assert _statuses(build(repo, force=True)) == {
        "alpha": BuildStatus.REBUILT,
        "beta": BuildStatus.REBUILT,
    }


@pytest.mark.parametrize("filename", ["normalise.py", "roster.toml"])
def test_editing_one_source_file_makes_only_that_source_stale(repo: Path, filename: str) -> None:
    build(repo)
    path = repo / "sources" / "alpha" / filename
    path.write_text((path.read_text() if path.exists() else "") + "\n# a harmless edit\n")

    report = build(repo)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.FRESH}


def test_editing_a_shared_data_file_makes_every_source_stale(repo: Path) -> None:
    """Hand-curated files directly under data/ (data/events.yaml) are read from outside a
    source's own directory, so build() folds them into every source's fingerprint."""
    build(repo)
    shared = repo / "data" / "manual.yaml"
    shared.write_text("v1\n")

    report_after_adding = build(repo)
    assert _statuses(report_after_adding) == {
        "alpha": BuildStatus.REBUILT,
        "beta": BuildStatus.REBUILT,
    }

    report_settled = build(repo)
    assert _statuses(report_settled) == {"alpha": BuildStatus.FRESH, "beta": BuildStatus.FRESH}

    shared.write_text("v2\n")
    report_after_editing = build(repo)
    assert _statuses(report_after_editing) == {
        "alpha": BuildStatus.REBUILT,
        "beta": BuildStatus.REBUILT,
    }


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


# ------------------------------------------------------------------ verified artefact reuse


# ------------------------------------------------------------------------------- outputs


def test_a_missing_declared_output_makes_an_otherwise_fresh_source_stale(tmp_path: Path) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    source_dir = sources_dir / "zeta"
    source_dir.mkdir()
    (source_dir / "manifest.toml").write_text(_MANIFEST_WITH_OUTPUTS_TEMPLATE.format(name="zeta"))
    (source_dir / "fetch.py").write_text(_FETCH_TEMPLATE.format(value=1.0))
    (source_dir / "normalise.py").write_text(
        _NORMALISE_WITH_WRITE_OUTPUTS_TEMPLATE.format(id="zeta")
    )

    build(tmp_path)
    output_file = tmp_path / "outputs" / "zeta" / "epoch.txt"
    assert output_file.is_file()

    second = build(tmp_path)
    assert _statuses(second) == {"zeta": BuildStatus.FRESH}

    output_file.unlink()

    third = build(tmp_path)
    assert _statuses(third) == {"zeta": BuildStatus.REBUILT}
    assert output_file.is_file()  # the hook re-ran and rewrote it


# ------------------------------------------------------------------------ discover_sources


# -------------------------------------------------------------------------------- fingerprint
