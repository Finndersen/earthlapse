"""Offline validator for sources/co2-o2, run against the committed fixture only.

Covers the two traps documented in ONESHOT_SCOPE.md § "Two traps":
- RCO2 -> ppm requires `* 280`, not a bare copy (would be off by 280x).
- Column 1 is negative Ma; `t` must be `abs(Ma) * 1e6`, positive years BP.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import httpx
import pytest

from pipeline.fetching import FetchIntegrityError
from pipeline.shapes import Interpolation, TimeSeries
from tests.sources.support import fixture_dir, load_source_module

PREINDUSTRIAL_CO2_PPM = 280.0


@pytest.fixture(scope="module")
def co2_series() -> TimeSeries:
    normalise = load_source_module("co2-o2", "normalise")
    shapes = normalise.normalise(fixture_dir("co2-o2"))
    assert len(shapes) == 1
    shape = shapes[0]
    assert isinstance(shape, TimeSeries)
    return shape


def test_shape_metadata(co2_series: TimeSeries) -> None:
    assert co2_series.id == "co2"
    assert co2_series.unit == "ppm"
    assert co2_series.interpolation == Interpolation.LOG_LINEAR


def test_present_day_conversion_is_rco2_times_280_not_the_bare_ratio(
    co2_series: TimeSeries,
) -> None:
    """RCO2 at 0 Ma is 0.9879701. The curated value must be that times 280 (~276.6 ppm),
    never ~1 ppm — the classic 280x unit-conversion miss."""
    value = co2_series.sample(0.0)
    assert value is not None
    expected = 0.988 * PREINDUSTRIAL_CO2_PPM
    assert value == pytest.approx(expected, abs=0.5)
    assert value > 100.0  # sanity guard against the "still ~1" regression


def test_max_checkpoint_at_520_ma(co2_series: TimeSeries) -> None:
    """RCO2 peaks at 26.18222 @ 520 Ma (t = 5.2e8), per ONESHOT_SCOPE.md's range check."""
    value = co2_series.sample(5.2e8)
    assert value is not None
    expected = 26.18 * PREINDUSTRIAL_CO2_PPM
    assert value == pytest.approx(expected, abs=1.0)


def test_negative_ma_column_becomes_positive_years_bp(co2_series: TimeSeries) -> None:
    """Column 1 is negative Ma (e.g. -570). t must be abs(Ma) * 1e6, and the domain must
    span the full 570 Myr record with t increasing into the past."""
    newest, oldest = co2_series.domain
    assert newest == pytest.approx(0.0)
    assert oldest == pytest.approx(5.7e8)
    assert all(s.t >= 0.0 for s in co2_series.samples)


def test_sample_beyond_570_ma_coverage_is_none(co2_series: TimeSeries) -> None:
    """Coverage stops at 5.7e8 BP (570 Ma) — 12.4% of the timeline. Beyond that the
    WorldState must see absence, not an extrapolated or clamped value."""
    assert co2_series.sample(6e8) is None


def test_no_fabricated_uncertainty_band(co2_series: TimeSeries) -> None:
    """GEOCARB III ships no error column. lower/upper must stay None rather than an
    invented band."""
    assert all(s.lower is None and s.upper is None for s in co2_series.samples)


def test_log_linear_interpolation_between_bracketing_samples(co2_series: TimeSeries) -> None:
    """340 Ma and 350 Ma bracket a steep drop (RCO2 2.704967 -> 4.337569) large enough that
    log-linear and linear blends diverge by ~27 ppm at the midpoint — enough to catch a
    silent fallback to linear interpolation."""
    t_340, t_350 = 3.4e8, 3.5e8
    v_340 = co2_series.sample(t_340)
    v_350 = co2_series.sample(t_350)
    assert v_340 is not None
    assert v_350 is not None

    t_mid = (t_340 + t_350) / 2
    expected_log_linear = math.exp((math.log(v_340) + math.log(v_350)) / 2)
    expected_linear = (v_340 + v_350) / 2
    assert abs(expected_log_linear - expected_linear) > 20.0  # the two methods must differ

    value_mid = co2_series.sample(t_mid)
    assert value_mid is not None
    assert value_mid == pytest.approx(expected_log_linear, rel=1e-6)


# ----------------------------------------------------------------------------------- fetch
#
# fetch()'s own manifest.toml is swapped for a tmp_path fixture the test controls (so
# these don't depend on the real upstream sha256), and only the HTTP layer -- httpx.get,
# the single call `_download` makes -- is faked. Everything else (ensure_verified_artefact's
# reuse/verify logic, sha256 checking) runs for real.


def _write_manifest(path: Path, *, url: str, sha256: str) -> None:
    path.write_text(
        f'name = "co2-o2"\nurl = "{url}"\nsha256 = "{sha256}"\n'
        'licence = "test"\ncitation = "test"\ntime_domain = [0, 0]\n'
        'output_shape = "TimeSeries"\ninterpolation = "log-linear"\n'
        'volume_bytes = 0\nstorage_tier = "git"\n'
    )


@pytest.fixture
def fetch_module(tmp_path, monkeypatch):
    module = load_source_module("co2-o2", "fetch")
    monkeypatch.setattr(module, "_MANIFEST", tmp_path / "manifest.toml")
    return module


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


def test_fetch_reuses_an_already_verified_file_without_calling_httpx_get(
    fetch_module, tmp_path, monkeypatch
) -> None:
    content = b"DATA:\n0.0 1.0\n"
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/data.txt",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / fetch_module._RAW_FILENAME).write_bytes(content)

    def _must_not_be_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.get must not be called when the cached file already verifies")

    monkeypatch.setattr(httpx, "get", _must_not_be_called)

    fetch_module.fetch(raw_dir)

    assert (raw_dir / fetch_module._RAW_FILENAME).read_bytes() == content


def test_fetch_downloads_and_writes_the_file_when_none_is_cached(
    fetch_module, tmp_path, monkeypatch
) -> None:
    content = b"DATA:\n0.0 1.0\n"
    _write_manifest(
        tmp_path / "manifest.toml",
        url="https://example.invalid/data.txt",
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_dir = tmp_path / "raw"
    calls = []

    def _fake_get(url: str, **kwargs: object) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse(content)

    monkeypatch.setattr(httpx, "get", _fake_get)

    fetch_module.fetch(raw_dir)

    assert calls == ["https://example.invalid/data.txt"]
    assert (raw_dir / fetch_module._RAW_FILENAME).read_bytes() == content


def test_fetch_raises_and_writes_nothing_on_a_sha256_mismatch(
    fetch_module, tmp_path, monkeypatch
) -> None:
    _write_manifest(
        tmp_path / "manifest.toml", url="https://example.invalid/data.txt", sha256="0" * 64
    )
    raw_dir = tmp_path / "raw"
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: _FakeResponse(b"corrupt"))

    with pytest.raises(FetchIntegrityError):
        fetch_module.fetch(raw_dir)

    assert not (raw_dir / fetch_module._RAW_FILENAME).exists()
