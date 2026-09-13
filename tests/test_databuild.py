"""Offline tests for pipeline.databuild, against a fake sources/ tree under tmp_path --
no network, no real sources/ or data/ directories touched.
"""

from __future__ import annotations

import hashlib
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

_MANIFEST_WITH_OUTPUTS_TEMPLATE = _MANIFEST_TEMPLATE + 'outputs = ["outputs/{name}/*.txt"]\n'

_FETCH_WITH_VERIFIED_ARTEFACT_TEMPLATE = """\
from __future__ import annotations

from pathlib import Path

from pipeline.fetching import ensure_verified_artefact

_CONTENT = {content!r}
_SHA256 = {sha256!r}
_CALLS_LOG = Path({calls_log!r})


def _download() -> bytes:
    with _CALLS_LOG.open("a") as f:
        f.write("x")
    return _CONTENT


def fetch(raw_dir: Path) -> None:
    ensure_verified_artefact(raw_dir, "artefact.bin", _SHA256, _download)
"""

_NORMALISE_READS_ARTEFACT_TEMPLATE = """\
from __future__ import annotations

from pathlib import Path

from pipeline.shapes import CuratedShape, Interpolation, Sample, TimeSeries


def normalise(raw_dir: Path) -> list[CuratedShape]:
    value = float((raw_dir / "artefact.bin").read_text())
    return [
        TimeSeries(
            id={id!r},
            unit="u",
            interpolation=Interpolation.LINEAR,
            samples=[Sample(t=0.0, value=value)],
        )
    ]
"""

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

_NORMALISE_WITH_TWO_OUTPUTS_TEMPLATE = """\
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
    (out_dir / "a.txt").write_text("a")
    (out_dir / "b.txt").write_text("b")
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


def test_force_rebuilds_a_source_that_would_otherwise_be_fresh(repo: Path) -> None:
    first = build(repo)
    assert _statuses(first) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}

    report = build(repo, force=True)

    assert _statuses(report) == {"alpha": BuildStatus.REBUILT, "beta": BuildStatus.REBUILT}


# ------------------------------------------------------------------ verified artefact reuse


def test_a_verified_raw_artefact_already_on_disk_is_reused_without_a_download_call(
    tmp_path: Path,
) -> None:
    """A source whose fetch.py uses pipeline.fetching.ensure_verified_artefact must not hit
    the network on a rebuild triggered for an unrelated reason (here, editing normalise.py)
    once its raw artefact is already on disk and verifies -- the exact bug this hardens
    against (zenodo.org flapping with 504s on an already-downloaded, still-valid source)."""
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    calls_log = tmp_path / "download_calls.txt"
    content = b"3.0"
    sha256 = hashlib.sha256(content).hexdigest()
    source_dir = sources_dir / "gamma"
    source_dir.mkdir()
    (source_dir / "manifest.toml").write_text(_MANIFEST_TEMPLATE.format(name="gamma"))
    (source_dir / "fetch.py").write_text(
        _FETCH_WITH_VERIFIED_ARTEFACT_TEMPLATE.format(
            content=content, sha256=sha256, calls_log=str(calls_log)
        )
    )
    (source_dir / "normalise.py").write_text(_NORMALISE_READS_ARTEFACT_TEMPLATE.format(id="gamma"))

    first = build(tmp_path)
    assert _statuses(first) == {"gamma": BuildStatus.REBUILT}
    assert calls_log.read_text().count("x") == 1

    (source_dir / "normalise.py").write_text(
        (source_dir / "normalise.py").read_text() + "\n# unrelated edit\n"
    )

    second = build(tmp_path)
    assert _statuses(second) == {"gamma": BuildStatus.REBUILT}
    assert calls_log.read_text().count("x") == 1  # no second download call


def test_a_download_not_matching_the_expected_sha256_fails_the_build_loudly(
    tmp_path: Path,
) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    calls_log = tmp_path / "download_calls.txt"
    wrong_sha256 = "0" * 64
    source_dir = sources_dir / "delta"
    source_dir.mkdir()
    (source_dir / "manifest.toml").write_text(_MANIFEST_TEMPLATE.format(name="delta"))
    (source_dir / "fetch.py").write_text(
        _FETCH_WITH_VERIFIED_ARTEFACT_TEMPLATE.format(
            content=b"3.0", sha256=wrong_sha256, calls_log=str(calls_log)
        )
    )
    (source_dir / "normalise.py").write_text(_NORMALISE_READS_ARTEFACT_TEMPLATE.format(id="delta"))

    report = build(tmp_path)

    result = report.results[0]
    assert result.status is BuildStatus.FAILED
    assert "sha256" in (result.error or "")
    assert not (tmp_path / "data" / "curated" / "delta.parquet").exists()


# ------------------------------------------------------------------------------- outputs


def test_write_outputs_hook_runs_after_normalise_and_writes_the_declared_files(
    tmp_path: Path,
) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    source_dir = sources_dir / "epsilon"
    source_dir.mkdir()
    (source_dir / "manifest.toml").write_text(
        _MANIFEST_WITH_OUTPUTS_TEMPLATE.format(name="epsilon")
    )
    (source_dir / "fetch.py").write_text(_FETCH_TEMPLATE.format(value=1.0))
    (source_dir / "normalise.py").write_text(
        _NORMALISE_WITH_WRITE_OUTPUTS_TEMPLATE.format(id="epsilon")
    )

    report = build(tmp_path)

    assert _statuses(report) == {"epsilon": BuildStatus.REBUILT}
    assert (tmp_path / "outputs" / "epsilon" / "epoch.txt").is_file()


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


def test_fewer_matching_outputs_than_the_stamp_recorded_makes_the_source_stale(
    tmp_path: Path,
) -> None:
    """Distinct from the "matches nothing" case above: here the glob still matches one file,
    just fewer than the two the stamp recorded -- also required to be stale."""
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    source_dir = sources_dir / "eta"
    source_dir.mkdir()
    (source_dir / "manifest.toml").write_text(_MANIFEST_WITH_OUTPUTS_TEMPLATE.format(name="eta"))
    (source_dir / "fetch.py").write_text(_FETCH_TEMPLATE.format(value=1.0))
    (source_dir / "normalise.py").write_text(_NORMALISE_WITH_TWO_OUTPUTS_TEMPLATE.format(id="eta"))

    build(tmp_path)
    out_dir = tmp_path / "outputs" / "eta"
    assert len(list(out_dir.glob("*.txt"))) == 2

    (out_dir / "b.txt").unlink()

    report = build(tmp_path)
    assert _statuses(report) == {"eta": BuildStatus.REBUILT}


# ------------------------------------------------------------------------ discover_sources


def test_discover_sources_excludes_directories_without_a_manifest_and_underscore_prefixed(
    tmp_path: Path,
) -> None:
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    _write_source(sources_dir, "alpha")
    (sources_dir / "_template").mkdir()
    (sources_dir / "_template" / "manifest.toml").write_text('name = "_template"\n')
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
