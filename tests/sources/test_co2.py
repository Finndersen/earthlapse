"""Offline validator for sources/co2-o2, run against the committed fixtures only.

The fixtures are the three real upstream files, byte-identical to what fetch.py verifies, so
splice boundaries here are the production ones. Covers:
- the splice (instrumental -> ice core -> GEOCARB III), disjoint in t;
- the three time conventions: CE year, years before AD 1950, negative Ma;
- GEOCARB's RCO2 -> ppm (`* 280`) trap;
- uncertainty taken from each file's own column, never invented for GEOCARB.
"""

from __future__ import annotations

import hashlib
import math
import shutil
from pathlib import Path

import httpx
import pytest

from pipeline.curated import load_world, write_shape
from pipeline.fetching import FetchIntegrityError
from pipeline.prompts import UnsourcedConditions, render_conditions
from pipeline.scenes import load_scene_book
from pipeline.shapes import Interpolation, Sample, TimeSeries
from tests.sources.support import REPO_ROOT, SOURCES_DIR, fixture_dir, load_source_module

PREINDUSTRIAL_CO2_PPM = 280.0
MLO_ROWS = 67  # 1959..2025
ICE_CORE_ROWS_KEPT = 1853  # 1,901 rows minus the 48 at AD 1959 or later
GEOCARB_ROWS_KEPT = 57  # 58 rows minus the 0 Ma model value
ICE_CORE_OLDEST_T = 805_668.87 + 75

normalise_module = load_source_module("co2-o2", "normalise")


@pytest.fixture(scope="module")
def co2_series() -> TimeSeries:
    shapes = normalise_module.normalise(fixture_dir("co2-o2"))
    assert len(shapes) == 1
    shape = shapes[0]
    assert isinstance(shape, TimeSeries)
    return shape


def _samples_between(series: TimeSeries, newest: float, oldest: float) -> list[Sample]:
    return [s for s in series.samples if newest <= s.t <= oldest]


def test_shape_metadata(co2_series: TimeSeries) -> None:
    assert (co2_series.id, co2_series.unit, co2_series.interpolation) == (
        "co2",
        "ppm",
        Interpolation.LOG_LINEAR,
    )
    assert co2_series.domain == (0.0, 5.7e8)


def test_segment_row_counts(co2_series: TimeSeries) -> None:
    assert len(_samples_between(co2_series, 0, 66)) == MLO_ROWS
    assert len(_samples_between(co2_series, 66.01, ICE_CORE_OLDEST_T)) == ICE_CORE_ROWS_KEPT
    assert len(_samples_between(co2_series, ICE_CORE_OLDEST_T + 1, 5.7e8)) == GEOCARB_ROWS_KEPT
    assert len(co2_series.samples) == MLO_ROWS + ICE_CORE_ROWS_KEPT + GEOCARB_ROWS_KEPT


def test_spliced_series_is_disjoint_in_t(co2_series: TimeSeries) -> None:
    times = [s.t for s in co2_series.samples]
    assert len(set(times)) == len(times)


# ----------------------------------------------------------------------- time conventions


def test_instrumental_years_count_back_from_the_2025_present(co2_series: TimeSeries) -> None:
    """Mauna Loa 2025 = 427.35 and 1959 = 315.98, each +/- 0.12: t = 2025 - year."""
    assert normalise_module.PRESENT_CE_YEAR == 2025
    newest, oldest = co2_series.samples[0], co2_series.samples[MLO_ROWS - 1]
    assert newest.model_dump() == pytest.approx(
        {"t": 0.0, "value": 427.35, "lower": 427.23, "upper": 427.47}
    )
    assert oldest.model_dump() == pytest.approx(
        {"t": 66.0, "value": 315.98, "lower": 315.86, "upper": 316.10}
    )


def test_ice_core_ages_are_rebased_from_1950_to_the_2025_present(co2_series: TimeSeries) -> None:
    """The composite's `age_gas_calBP` counts back from AD 1950, so t = age + 75. The row at
    age 20,964.43 (190.87 +/- 0.82 ppm) must land at t = 21,039.43, not at t = 20,964.43
    where an un-offset parse would put it."""
    assert normalise_module.ICE_CORE_AGE_OFFSET_YEARS == 75
    rebased = next(s for s in co2_series.samples if s.t == pytest.approx(21_039.43))
    assert rebased.model_dump() == pytest.approx(
        {"t": 21_039.43, "value": 190.87, "lower": 190.05, "upper": 191.69}
    )
    assert all(s.t != pytest.approx(20_964.43) for s in co2_series.samples)


def test_ice_core_rows_overlapping_the_instrumental_record_are_dropped(
    co2_series: TimeSeries,
) -> None:
    """The composite's youngest row, age -51.03 BP (AD 2001, 368.02 ppm), would be t = 23.97.
    Instrumental years win: every sample at t <= 66 is a whole-year Mauna Loa row, and the
    oldest-kept ice-core row is the first strictly older than 1959 (age -8.56 -> t = 66.44)."""
    assert [s.t for s in _samples_between(co2_series, 0, 66)] == [float(t) for t in range(67)]
    assert co2_series.samples[MLO_ROWS].t == pytest.approx(66.44)


def test_geocarb_model_value_at_0_ma_is_replaced_by_measurements(co2_series: TimeSeries) -> None:
    """GEOCARB's 0 Ma sample (276.6 ppm) is a pre-industrial baseline; nothing between the
    ice core's oldest row and GEOCARB's 10 Ma row may survive the splice."""
    assert all(
        s.value != pytest.approx(0.9879701 * PREINDUSTRIAL_CO2_PPM) for s in co2_series.samples
    )
    assert _samples_between(co2_series, ICE_CORE_OLDEST_T + 1, 1e7 - 1) == []


# ------------------------------------------------------------------ checkpoints and traps


@pytest.mark.parametrize(
    ("t", "low", "high"),
    [
        (0.0, 420.0, 428.0),  # AD 2025
        (67.0, 314.0, 317.0),  # AD 1958
        (275.0, 277.0, 280.0),  # AD 1750
        (21_000.0, 185.0, 200.0),  # Last Glacial Maximum
    ],
)
def test_recent_checkpoints(co2_series: TimeSeries, t: float, low: float, high: float) -> None:
    value = co2_series.sample(t)
    assert value is not None
    assert low <= value <= high


@pytest.mark.parametrize(
    ("t", "rco2"),
    [
        (1e7, 0.990113),
        (1e8, 5.30103),
        (3e8, 1.249976),
        (5.2e8, 26.18222),  # the record's maximum
        (5.7e8, 11.70362),
    ],
)
def test_deep_time_geocarb_values_are_unchanged(
    co2_series: TimeSeries, t: float, rco2: float
) -> None:
    """RCO2 is a ratio: ppm = RCO2 * 280, never the bare ~1 ratio."""
    assert co2_series.sample(t) == pytest.approx(rco2 * PREINDUSTRIAL_CO2_PPM)


def test_sample_beyond_570_ma_coverage_is_none(co2_series: TimeSeries) -> None:
    assert co2_series.sample(6e8) is None


def test_log_linear_interpolation_between_bracketing_samples(co2_series: TimeSeries) -> None:
    """340 Ma and 350 Ma bracket a steep drop (RCO2 2.704967 -> 4.337569) large enough that
    log-linear and linear blends diverge by ~27 ppm at the midpoint — enough to catch a
    silent fallback to linear interpolation."""
    v_340 = co2_series.sample(3.4e8)
    v_350 = co2_series.sample(3.5e8)
    assert v_340 is not None
    assert v_350 is not None

    expected_log_linear = math.exp((math.log(v_340) + math.log(v_350)) / 2)
    expected_linear = (v_340 + v_350) / 2
    assert abs(expected_log_linear - expected_linear) > 20.0

    assert co2_series.sample(3.45e8) == pytest.approx(expected_log_linear, rel=1e-6)


def test_uncertainty_comes_only_from_the_files_own_columns(co2_series: TimeSeries) -> None:
    """Mauna Loa and ice-core rows carry their published sigma as a symmetric band; GEOCARB III
    ships no error column, so its rows keep no band rather than an invented one."""
    measured = _samples_between(co2_series, 0, ICE_CORE_OLDEST_T)
    modelled = _samples_between(co2_series, ICE_CORE_OLDEST_T + 1, 5.7e8)
    assert all(
        s.lower is not None
        and s.upper is not None
        and s.lower < s.value < s.upper
        and s.value - s.lower == pytest.approx(s.upper - s.value)
        for s in measured
    )
    assert all(s.lower is None and s.upper is None for s in modelled)


def test_worldstate_reads_the_spliced_series(co2_series: TimeSeries, tmp_path: Path) -> None:
    write_shape(co2_series, tmp_path)
    world = load_world(tmp_path)
    readings = {t: world.at(t).atmosphere.co2_ppm for t in (0.0, 67.0, 275.0, 1e7, 5.2e8, 6e8)}
    assert readings == {
        0.0: pytest.approx(427.35),
        67.0: pytest.approx(315.4, abs=0.5),
        275.0: pytest.approx(277.2, abs=0.5),
        1e7: pytest.approx(0.990113 * PREINDUSTRIAL_CO2_PPM),
        5.2e8: pytest.approx(26.18222 * PREINDUSTRIAL_CO2_PPM),
        6e8: None,
    }


# ------------------------------------------------------------------------- the declared gap


def test_ice_core_to_geocarb_bridge_is_declared_as_a_gap(co2_series: TimeSeries) -> None:
    """ADR-027: the splice's own boundary becomes a `Gap`, not a hand-kept span in a
    consumer (the deleted `CO2_UNRECORDED_SPAN`). If the splice changes (a Cenozoic segment
    landing, a re-pinned ice core), the gap's indices move with it because they are computed
    from the real kept counts, not a hard-coded age."""
    assert len(co2_series.gaps) == 1
    gap = co2_series.gaps[0]
    assert (gap.from_index, gap.to_index) == (
        MLO_ROWS + ICE_CORE_ROWS_KEPT - 1,
        MLO_ROWS + ICE_CORE_ROWS_KEPT,
    )
    assert co2_series.samples[gap.from_index].t == pytest.approx(ICE_CORE_OLDEST_T)
    assert co2_series.samples[gap.to_index].t == pytest.approx(1.0e7)


def test_sample_is_none_strictly_inside_the_gap_and_real_at_its_edges(
    co2_series: TimeSeries,
) -> None:
    gap = co2_series.gaps[0]
    newest, oldest = co2_series.samples[gap.from_index].t, co2_series.samples[gap.to_index].t
    assert co2_series.sample(newest) is not None  # oldest ice-core row: measured
    assert co2_series.sample(oldest) is not None  # GEOCARB III's 10 Ma row: modelled
    assert co2_series.sample((newest + oldest) / 2) is None
    assert co2_series.sample(3.2e6) is None  # Pliocene, where the bridge would read a glacial low


def test_scene_conditions_never_quote_the_bridge(co2_series: TimeSeries, tmp_path: Path) -> None:
    """Across the gap the log-linear bridge would have read 207-277 ppm: lucy-afarensis
    (3.2 Ma) would say "a glacial low" for the warm Pliocene. Every real scene inside the gap
    names it instead, and every scene the record covers outside it still quotes a figure."""
    write_shape(co2_series, tmp_path)
    world = load_world(tmp_path)
    gap = co2_series.gaps[0]
    newest, oldest = co2_series.samples[gap.from_index].t, co2_series.samples[gap.to_index].t
    no_estimates = UnsourcedConditions(o2_percent=None, mean_temp_c=None)
    scenes = load_scene_book(REPO_ROOT / "data" / "scenes.yaml").scenes
    rendered = {s.t: render_conditions(world.at(s.t), no_estimates) for s in scenes}

    inside = {t: text for t, text in rendered.items() if newest < t < oldest}
    covered_outside = {
        t: text for t, text in rendered.items() if not newest < t < oldest and t <= 5.7e8
    }
    assert inside, "no scene sits inside the gap, so this test checks nothing"
    assert all(
        "no CO2 record covers this interval" in text and "ppm" not in text
        for text in inside.values()
    )
    assert all("ppm" in text for text in covered_outside.values())


# ------------------------------------------------------------------------- strictness


@pytest.fixture
def raw_copy(tmp_path: Path) -> Path:
    raw_dir = tmp_path / "raw"
    shutil.copytree(fixture_dir("co2-o2"), raw_dir)
    return raw_dir


def test_an_instrumental_year_after_the_present_raises(raw_copy: Path) -> None:
    path = raw_copy / normalise_module.INSTRUMENTAL_FILENAME
    path.write_text(path.read_text() + "  2026   430.00     0.12\n")
    with pytest.raises(ValueError, match="year 2026 is after the fixed AD 2025 present"):
        normalise_module.normalise(raw_copy)


def test_a_duplicate_t_within_a_segment_raises(raw_copy: Path) -> None:
    path = raw_copy / normalise_module.INSTRUMENTAL_FILENAME
    path.write_text(path.read_text() + "  2025   427.35     0.12\n")
    with pytest.raises(ValueError, match="duplicate t values"):
        normalise_module.normalise(raw_copy)


def test_an_unparseable_ice_core_row_raises(raw_copy: Path) -> None:
    path = raw_copy / normalise_module.ICE_CORE_FILENAME
    path.write_text(path.read_text(encoding="utf-8") + "not\ta\trow\n", encoding="utf-8")
    with pytest.raises(ValueError, match="unparseable data row"):
        normalise_module.normalise(raw_copy)


# ----------------------------------------------------------------------------- fetch
#
# fetch()'s own manifest.toml is swapped for a tmp_path fixture the test controls (so these
# don't depend on the real upstream sha256s), and only the HTTP layer -- httpx.get, the single
# call `_download` makes -- is faked. Everything else (ensure_verified_artefact's reuse/verify
# logic, sha256 checking) runs for real.

fetch_source = load_source_module("co2-o2", "fetch")


def test_manifest_artefacts_are_exactly_the_files_normalise_reads() -> None:
    artefacts = fetch_source.load_artefacts(SOURCES_DIR / "co2-o2" / "manifest.toml")
    assert tuple(a.filename for a in artefacts) == normalise_module.RAW_FILENAMES


def test_committed_fixtures_are_the_pinned_upstream_files() -> None:
    artefacts = fetch_source.load_artefacts(SOURCES_DIR / "co2-o2" / "manifest.toml")
    assert {
        a.filename: hashlib.sha256((fixture_dir("co2-o2") / a.filename).read_bytes()).hexdigest()
        for a in artefacts
    } == {a.filename: a.sha256 for a in artefacts}


_CONTENTS = {"a.txt": b"alpha\n", "b.txt": b"beta\n"}


def _sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _write_manifest(path: Path, sha256s: dict[str, str]) -> None:
    entries = "".join(
        f'[[artefacts]]\nfilename = "{name}"\nurl = "https://example.invalid/{name}"\n'
        f'sha256 = "{sha}"\nlicence = "test"\ncitation = "test"\n\n'
        for name, sha in sha256s.items()
    )
    path.write_text(f'name = "co2-o2"\n\n{entries}')


@pytest.fixture
def fetch_module(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch_source, "_MANIFEST", tmp_path / "manifest.toml")
    return fetch_source


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_downloads_only_the_artefacts_not_already_verified_on_disk(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_manifest(
        tmp_path / "manifest.toml", {name: _sha(content) for name, content in _CONTENTS.items()}
    )
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "a.txt").write_bytes(_CONTENTS["a.txt"])
    calls = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse(_CONTENTS[url.rsplit("/", 1)[-1]])

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(raw_dir)

    assert calls == ["https://example.invalid/b.txt"]
    assert {p.name: p.read_bytes() for p in raw_dir.iterdir()} == _CONTENTS


def test_fetch_raises_and_writes_nothing_on_a_sha256_mismatch(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_manifest(tmp_path / "manifest.toml", {"a.txt": "0" * 64})
    raw_dir = tmp_path / "raw"
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(b"corrupt"))

    with pytest.raises(FetchIntegrityError):
        fetch_module.fetch(raw_dir)

    assert not (raw_dir / "a.txt").exists()
