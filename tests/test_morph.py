"""Portrait morph fields from synthetic plates. Needs the optional `morph` extra (OpenCV)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

cv2 = pytest.importorskip("cv2")

from pipeline.flowfield import FLOW_TEXTURE_SIZE, SubjectBox, decode_flow, texel_centres
from pipeline.morph import (
    FORCED_DISSOLVE_PAIRS,
    MAX_FLOW_P95,
    MAX_INVERSE_CONSISTENCY,
    MAX_MORPH_ZOOM,
    SCALE_BAR_BAND_ABOVE,
    SCALE_BAR_BAND_BELOW,
    SCALE_BAR_BAND_RIGHT_MARGIN,
    SUBJECT_FILL,
    ZERO_BAND_FEATHER_SIGMA,
    BarSearchExtent,
    MorphError,
    backdrop_level,
    bar_search_extent,
    bounded_fills,
    compute_morph,
    detect_subject_box,
    erase_band,
    flow_smoothing_sigma,
    inverse_consistency,
    load_plate,
    normalised_flow,
    pose_divergence,
    refuse_bursting_flow,
    scale_bar_band,
    write_morph,
    zero_band,
)
from pipeline.portraits import (
    BACKWARD_FLOW_NAME,
    FORWARD_FLOW_NAME,
    MORPH_ALGORITHM_VERSION,
    MorphKey,
    MorphRecord,
    load_morph,
)

PLATE_SIZE = 512


def _plate(centre: tuple[float, float], radii: tuple[float, float], bar: bool = True) -> np.ndarray:
    """A dark backdrop, a striped bright ellipse for a subject, and (by default) a thin scale bar
    just below it, left of centre — the same relative placement VISUAL_SPEC §10 describes."""
    size = PLATE_SIZE
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) / size
    inside = ((x - centre[0]) / radii[0]) ** 2 + ((y - centre[1]) / radii[1]) ** 2 <= 1
    local_u = (x - centre[0]) / radii[0]
    local_v = (y - centre[1]) / radii[1]
    texture = 150 + 60 * np.sin(local_u * 9) * np.cos(local_v * 7)
    plate = np.full((size, size), 12.0)
    plate[inside] = texture[inside]
    if bar:
        bar_top = int(min(0.98, centre[1] + radii[1] + 0.04) * size)
        bar_bottom = min(size, bar_top + 2)
        bar_left = int(max(0.0, centre[0] - radii[0]) * size)
        bar_right = int(min(1.0, centre[0]) * size)
        plate[bar_top:bar_bottom, bar_left:bar_right] = 180
    return plate.astype(np.uint8)


def _write(path: Path, plate: np.ndarray) -> Path:
    Image.fromarray(plate, "L").save(path)
    return path


def test_the_subject_box_holds_the_organism_and_not_the_scale_bar() -> None:
    box = detect_subject_box(_plate(centre=(0.4, 0.5), radii=(0.25, 0.15)))

    assert (box.left, box.top, box.right, box.bottom) == pytest.approx(
        (0.15, 0.35, 0.65, 0.65), abs=0.02
    )


def test_a_plate_with_nothing_on_its_backdrop_is_refused() -> None:
    with pytest.raises(MorphError, match="no subject"):
        detect_subject_box(np.full((PLATE_SIZE, PLATE_SIZE), 12, dtype=np.uint8))


def test_a_non_square_plate_is_refused(tmp_path: Path) -> None:
    path = _write(tmp_path / "wide.png", np.zeros((90, 160), dtype=np.uint8))

    with pytest.raises(MorphError, match="square"):
        load_plate(path)


def test_the_morph_bends_each_plate_onto_the_other_far_better_than_no_morph() -> None:
    older = _plate(centre=(0.45, 0.5), radii=(0.2, 0.12))
    younger = _plate(centre=(0.52, 0.5), radii=(0.22, 0.13))

    morph = compute_morph(older, younger)

    assert morph.fallback_dissolve is False
    assert morph.forward.shape == morph.backward.shape == (FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2)
    for source, target, field in (
        (older, younger, morph.forward),
        (younger, older, morph.backward),
    ):
        assert _warp_error(source, target, field) < 0.5 * _warp_error(
            source, target, np.zeros_like(field)
        )


def test_an_incoherent_pair_falls_back_to_a_plain_dissolve(monkeypatch: pytest.MonkeyPatch) -> None:
    """Past `MAX_INVERSE_CONSISTENCY`, `compute_morph` degrades to an all-zero field (a plain
    crossfade) rather than ship a tangled one (queue item 14). A striped ellipse is simple enough
    that DIS bends even a fairly pose-divergent pair coherently under the fixed pipeline (a good
    sign for real plates), so the threshold is forced to 0 here to exercise the branch itself,
    rather than searching for synthetic geometry that happens to sit past a moving calibration."""
    monkeypatch.setattr("pipeline.morph.MAX_INVERSE_CONSISTENCY", 0.0)
    older = _plate(centre=(0.35, 0.5), radii=(0.2, 0.12))
    younger = _plate(centre=(0.6, 0.45), radii=(0.3, 0.15))

    morph = compute_morph(older, younger)

    assert morph.fallback_dissolve is True
    assert np.count_nonzero(morph.forward) == 0
    assert np.count_nonzero(morph.backward) == 0


def test_a_well_matched_pair_keeps_the_plate_style_fill() -> None:
    older = SubjectBox(left=0.1, top=0.2, right=0.9, bottom=0.8)
    younger = SubjectBox(left=0.15, top=0.1, right=0.85, bottom=0.9)

    assert bounded_fills(older, younger) == pytest.approx((SUBJECT_FILL, SUBJECT_FILL))


def test_a_lone_cell_and_a_plate_filling_colony_are_framed_at_most_max_morph_zoom_apart() -> None:
    cell = SubjectBox(left=0.4, top=0.4, right=0.6, bottom=0.6)
    colony = SubjectBox(left=0.05, top=0.05, right=0.95, bottom=0.95)

    cell_fill, colony_fill = bounded_fills(cell, colony)

    assert (cell_fill / cell.span) / (colony_fill / colony.span) == pytest.approx(MAX_MORPH_ZOOM)


def test_a_small_subject_morphs_into_a_large_one_without_bursting() -> None:
    cell = _plate(centre=(0.5, 0.5), radii=(0.06, 0.05))
    colony = _plate(centre=(0.5, 0.5), radii=(0.42, 0.4))

    morph = compute_morph(cell, colony)

    for field in (morph.forward, morph.backward):
        assert np.percentile(np.hypot(field[..., 0], field[..., 1]), 95) <= MAX_FLOW_P95


@pytest.mark.parametrize(("reach", "refused"), [(0.9, False), (1.1, True)])
def test_a_field_flinging_most_of_the_plate_past_the_bound_is_refused(
    reach: float, refused: bool
) -> None:
    field = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), dtype=np.float32)
    field[..., 0] = reach * MAX_FLOW_P95

    if refused:
        with pytest.raises(MorphError, match="burst"):
            refuse_bursting_flow(field)
    else:
        refuse_bursting_flow(field)


# -- scale-bar band (ADR-015 amendment 2026-09-15) -------------------------------------------


def test_the_scale_bar_band_brackets_the_bar_and_stays_left_of_centre() -> None:
    box = detect_subject_box(_plate(centre=(0.4, 0.5), radii=(0.25, 0.15)))

    band = scale_bar_band(box)

    assert band.left == 0.0
    assert band.top == pytest.approx(box.bottom - SCALE_BAR_BAND_ABOVE)
    assert band.bottom == pytest.approx(box.bottom + SCALE_BAR_BAND_BELOW)
    assert band.right == pytest.approx((box.left + box.right) / 2 + SCALE_BAR_BAND_RIGHT_MARGIN)
    # The synthetic bar itself (see `_plate`) falls inside the band it brackets.
    bar_top = box.bottom + 0.04
    assert band.top <= bar_top <= band.bottom
    assert box.right - (box.left + box.right) / 2 < SCALE_BAR_BAND_RIGHT_MARGIN or band.right < 1.0


def test_scale_bar_band_is_never_empty_even_at_the_frame_edge() -> None:
    box = SubjectBox(left=0.1, top=0.1, right=0.9, bottom=0.999)

    band = scale_bar_band(box)

    assert band.top < band.bottom
    assert band.right > band.left


def test_erase_band_paints_only_the_band_at_the_backdrop_level() -> None:
    plate = _plate(centre=(0.4, 0.5), radii=(0.25, 0.15))
    box = detect_subject_box(plate)
    band = scale_bar_band(box)
    level = backdrop_level(plate)
    no_subject = np.zeros((PLATE_SIZE, PLATE_SIZE), dtype=bool)

    erased = erase_band(plate, band, level, no_subject)

    inside_rows = slice(int(band.top * PLATE_SIZE) + 1, int(band.bottom * PLATE_SIZE) - 1)
    inside_columns = slice(int(band.left * PLATE_SIZE) + 1, int(band.right * PLATE_SIZE) - 1)
    assert np.all(erased[inside_rows, inside_columns] == round(level))
    # Well clear of the band on every side, nothing moved.
    assert np.array_equal(
        erased[:, : int(band.left * PLATE_SIZE)], plate[:, : int(band.left * PLATE_SIZE)]
    )
    above = max(0, int(band.top * PLATE_SIZE) - 5)
    assert np.array_equal(erased[:above], plate[:above])
    below = min(PLATE_SIZE, int(band.bottom * PLATE_SIZE) + 5)
    assert np.array_equal(erased[below:], plate[below:])


def test_erase_band_never_paints_over_a_subject_pixel() -> None:
    """A band that geometrically overlaps the subject (its anchor is an approximation) must
    still never erase anatomy -- only ever backdrop (queue item 14 QA, 2026-09-16)."""
    plate = _plate(centre=(0.4, 0.5), radii=(0.25, 0.15))
    box = detect_subject_box(plate)
    band = scale_bar_band(box)
    level = backdrop_level(plate)
    subject = np.zeros((PLATE_SIZE, PLATE_SIZE), dtype=bool)
    # A block that overlaps the band's own top-left corner.
    top, bottom = int(band.top * PLATE_SIZE), int(band.top * PLATE_SIZE) + 20
    left, right = 0, 20
    subject[top:bottom, left:right] = True

    erased = erase_band(plate, band, level, subject)

    assert np.array_equal(erased[top:bottom, left:right], plate[top:bottom, left:right])


def test_zero_band_zeroes_only_the_band() -> None:
    box = SubjectBox(left=0.1, top=0.1, right=0.9, bottom=0.6)
    band = scale_bar_band(box)
    field = np.full((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), 0.3, dtype=np.float32)
    no_subject = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE), dtype=bool)

    zeroed = zero_band(field, band, FLOW_TEXTURE_SIZE, no_subject)

    # Well clear of the band's feathered edge (a few kernels' worth of sigma), the result is
    # either untouched or fully zeroed.
    margin = round(4 * ZERO_BAND_FEATHER_SIGMA)
    band_top, band_bottom = int(band.top * FLOW_TEXTURE_SIZE), int(band.bottom * FLOW_TEXTURE_SIZE)
    band_left, band_right = int(band.left * FLOW_TEXTURE_SIZE), int(band.right * FLOW_TEXTURE_SIZE)
    rows = slice(band_top + margin, band_bottom - margin)
    columns = slice(band_left + margin, band_right - margin)
    assert np.all(np.abs(zeroed[rows, columns]) < 1e-3)
    assert np.all(zeroed[: band_top - margin] == 0.3)  # untouched, well above the band


def test_zero_band_never_zeroes_a_subject_pixel_even_inside_the_band() -> None:
    box = SubjectBox(left=0.1, top=0.1, right=0.9, bottom=0.6)
    band = scale_bar_band(box)
    field = np.full((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), 0.3, dtype=np.float32)
    subject = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE), dtype=bool)
    top = int(band.top * FLOW_TEXTURE_SIZE)
    subject[top : top + 3, :10] = True  # squarely inside the band

    zeroed = zero_band(field, band, FLOW_TEXTURE_SIZE, subject)

    assert np.array_equal(zeroed[top : top + 3, :10], field[top : top + 3, :10])


def test_zero_band_feathers_its_edge_instead_of_cutting_hard() -> None:
    box = SubjectBox(left=0.1, top=0.1, right=0.9, bottom=0.6)
    band = scale_bar_band(box)
    field = np.full((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), 0.3, dtype=np.float32)
    no_subject = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE), dtype=bool)

    zeroed = zero_band(field, band, FLOW_TEXTURE_SIZE, no_subject)

    top = int(band.top * FLOW_TEXTURE_SIZE)
    just_above = zeroed[top - 1, 5, 0]
    # Neither the original value nor exactly zero: a soft transition, not a hard tear.
    assert 0.0 < just_above < 0.3


# -- pose-divergent smoothing (ADR-015 amendment 2026-09-15) ---------------------------------


def test_pose_divergence_is_zero_for_identically_shaped_boxes() -> None:
    a = SubjectBox(left=0.2, top=0.3, right=0.8, bottom=0.7)  # width 0.6, height 0.4
    b = SubjectBox(left=0.35, top=0.4, right=0.65, bottom=0.6)  # half the scale, same aspect

    assert pose_divergence(a, a) == 0.0
    assert pose_divergence(a, b) == pytest.approx(0.0, abs=1e-9)


def test_pose_divergence_is_symmetric_and_grows_with_shape_mismatch() -> None:
    squat = SubjectBox(left=0.0, top=0.4, right=1.0, bottom=0.6)  # wide and short
    upright = SubjectBox(left=0.4, top=0.0, right=0.6, bottom=1.0)  # narrow and tall

    forward, backward = pose_divergence(squat, upright), pose_divergence(upright, squat)

    assert forward == pytest.approx(backward)
    assert forward > pose_divergence(squat, squat)


def test_flow_smoothing_sigma_widens_with_divergence_and_is_capped() -> None:
    from pipeline.morph import FLOW_SMOOTHING_SIGMA, MAX_FLOW_SMOOTHING_SIGMA

    assert flow_smoothing_sigma(0.0) == FLOW_SMOOTHING_SIGMA
    assert FLOW_SMOOTHING_SIGMA < flow_smoothing_sigma(0.5) < flow_smoothing_sigma(2.0)
    assert flow_smoothing_sigma(100.0) == MAX_FLOW_SMOOTHING_SIGMA


def test_normalised_flow_smooths_more_with_a_wider_sigma() -> None:
    older = _plate(centre=(0.45, 0.5), radii=(0.2, 0.12), bar=False)
    younger = _plate(centre=(0.5, 0.48), radii=(0.21, 0.13), bar=False)

    sharp = normalised_flow(older, younger, sigma=1.0)
    smooth = normalised_flow(older, younger, sigma=16.0)

    assert sharp.shape == smooth.shape
    # A wider kernel washes out local detail: the smoothed field varies less texel to texel.
    assert np.std(np.gradient(smooth[..., 0])) < np.std(np.gradient(sharp[..., 0]))


# -- vignette-robust scale-bar anchor (ADR-015 amendment 2026-09-16) -------------------------


def _vignette_plate(centre: tuple[float, float], radii: tuple[float, float]) -> np.ndarray:
    """`_plate`, with a radial glow behind the subject -- like the pinned corpus's own vignette
    (queue item 14 QA, 2026-09-16) -- strong enough at the plate's centre to put
    `detect_subject_box`'s single frame-corner threshold well past `MIN_CONTRAST` there, even
    with nothing but backdrop at that radius."""
    plate = _plate(centre=centre, radii=radii)
    size = PLATE_SIZE
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) / size
    radius = np.hypot(x - 0.5, y - 0.5)
    glow = (60 * np.clip(1 - radius / 0.6, 0.0, 1.0)).astype(np.float64)
    glowed = np.clip(plate.astype(np.float64) + np.where(plate < 40, glow, 0.0), 0, 255)
    return glowed.astype(np.uint8)


def test_bar_search_extent_holds_the_organism_and_not_the_scale_bar() -> None:
    extent = bar_search_extent(_plate(centre=(0.4, 0.5), radii=(0.25, 0.15)))

    assert isinstance(extent, BarSearchExtent)
    assert (extent.box.left, extent.box.top, extent.box.right, extent.box.bottom) == pytest.approx(
        (0.15, 0.35, 0.65, 0.65), abs=0.03
    )
    assert extent.band == scale_bar_band(extent.box)


def test_bar_search_extent_stays_tight_where_detect_subject_box_is_fooled_by_a_vignette() -> None:
    """The failure `SCALE_BAR_BAND_*`'s module comment names: a strong central glow inflates
    `detect_subject_box` (its threshold is a single value, not scaled to the glow), but
    `bar_search_extent`'s local-backdrop technique reads the same glow as backdrop wherever it
    falls."""
    plate = _vignette_plate(centre=(0.4, 0.5), radii=(0.15, 0.09))

    box, extent = detect_subject_box(plate), bar_search_extent(plate)

    assert extent is not None
    # The inflated box reaches far closer to the frame's own edge than the subject does.
    assert box.span > 2 * extent.box.span


def test_bar_search_extent_returns_a_square_binary_mask() -> None:
    extent = bar_search_extent(_plate(centre=(0.4, 0.5), radii=(0.25, 0.15)))

    assert extent is not None
    assert extent.mask.shape[0] == extent.mask.shape[1]
    assert set(np.unique(extent.mask)) <= {0, 255}


def test_mask_at_resamples_the_extent_mask_to_any_grid_size() -> None:
    from pipeline.morph import _mask_at

    extent = bar_search_extent(_plate(centre=(0.4, 0.5), radii=(0.25, 0.15)))
    assert extent is not None

    small, large = _mask_at(extent, FLOW_TEXTURE_SIZE), _mask_at(extent, PLATE_SIZE)

    assert small.shape == (FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE)
    assert large.shape == (PLATE_SIZE, PLATE_SIZE)
    assert small.dtype == bool and large.dtype == bool
    assert small.any() and large.any()  # the subject survives resampling both ways


# -- inverse consistency / dissolve fallback (ADR-015 amendment 2026-09-15) ------------------


def test_inverse_consistency_is_near_zero_for_an_exact_round_trip() -> None:
    forward = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), dtype=np.float32)
    forward[..., 0] = 0.1
    backward = np.zeros_like(forward)
    backward[..., 0] = -0.1  # exactly undoes forward everywhere
    # A small region well clear of the UV=1 edge, where `np.clip` cannot bend the round trip.
    region = SubjectBox(left=0.0, top=0.0, right=0.8, bottom=1.0)

    assert inverse_consistency(forward, backward, region, FLOW_TEXTURE_SIZE) == pytest.approx(
        0.0, abs=1e-6
    )


def test_inverse_consistency_is_positive_when_forward_and_backward_disagree() -> None:
    forward = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), dtype=np.float32)
    forward[..., 0] = 0.1
    backward = np.zeros_like(forward)  # does not undo forward at all
    region = SubjectBox(left=0.0, top=0.0, right=1.0, bottom=1.0)

    error = inverse_consistency(forward, backward, region, FLOW_TEXTURE_SIZE)

    assert error == pytest.approx(0.1, abs=1e-3)


def test_inverse_consistency_restricts_to_the_given_region() -> None:
    forward = np.zeros((FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2), dtype=np.float32)
    backward = np.zeros_like(forward)
    half = FLOW_TEXTURE_SIZE // 2
    forward[:half] = 0.2  # disagreement only in the top half
    left_region = SubjectBox(left=0.0, top=0.0, right=1.0, bottom=0.4)
    right_region = SubjectBox(left=0.0, top=0.6, right=1.0, bottom=1.0)

    assert inverse_consistency(forward, backward, left_region, FLOW_TEXTURE_SIZE) > 0.1
    assert inverse_consistency(forward, backward, right_region, FLOW_TEXTURE_SIZE) == pytest.approx(
        0.0, abs=1e-6
    )


def test_max_inverse_consistency_is_a_positive_threshold_below_a_plate_width() -> None:
    """A sanity bound on the calibrated constant itself, not just its callers."""
    assert 0.0 < MAX_INVERSE_CONSISTENCY < 1.0


def test_inverse_consistency_raises_when_the_region_holds_no_texel() -> None:
    """A degenerate region should surface as a bug, not silently dilute the statistic the way a
    whole-frame fallback would (ADR-015 amendment: rejected for the dissolve gate once already)."""
    size = 4  # texel centres at 0.125, 0.375, 0.625, 0.875 -- none fall in [0.2, 0.24)
    forward = np.zeros((size, size, 2), dtype=np.float32)
    backward = np.zeros_like(forward)
    region = SubjectBox(left=0.2, top=0.0, right=0.24, bottom=1.0)

    with pytest.raises(AssertionError, match="no texel"):
        inverse_consistency(forward, backward, region, size)


def _warp_error(source: np.ndarray, target: np.ndarray, field: np.ndarray) -> float:
    """Mean |source(p) - target(p + F(p))| over the source plate's subject texels."""
    u, v = texel_centres(FLOW_TEXTURE_SIZE)
    map_x = ((u + field[..., 0]) * PLATE_SIZE - 0.5).astype(np.float32)
    map_y = ((v + field[..., 1]) * PLATE_SIZE - 0.5).astype(np.float32)
    landed = cv2.remap(target.astype(np.float32), map_x, map_y, cv2.INTER_LINEAR, borderValue=0)
    here = cv2.resize(source, (FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE), interpolation=cv2.INTER_AREA)
    subject = here > 40
    return float(np.abs(here.astype(np.float32) - landed)[subject].mean())


def test_write_morph_caches_both_textures_and_a_record_under_the_pin_digests(
    tmp_path: Path,
) -> None:
    older = _write(tmp_path / "older.png", _plate(centre=(0.45, 0.5), radii=(0.2, 0.12)))
    younger = _write(tmp_path / "younger.png", _plate(centre=(0.52, 0.5), radii=(0.22, 0.13)))
    key = MorphKey(
        older="tetrapod", older_digest="a" * 16, younger="human", younger_digest="b" * 16
    )
    cache = tmp_path / "_morph"

    record = write_morph(cache, key, older, younger)

    assert record == MorphRecord(
        key=key,
        algorithm_version=MORPH_ALGORITHM_VERSION,
        size=FLOW_TEXTURE_SIZE,
        forward_range=record.forward_range,
        backward_range=record.backward_range,
        fallback_dissolve=False,
    )
    assert load_morph(cache, key) == record
    directory = key.directory(cache)
    assert directory == cache / "tetrapod--human" / (
        f"{'a' * 16}-{'b' * 16}-v{MORPH_ALGORITHM_VERSION}"
    )
    forward = decode_flow((directory / FORWARD_FLOW_NAME).read_bytes(), record.forward_range)
    assert np.abs(forward).max() <= record.forward_range
    assert (directory / BACKWARD_FLOW_NAME).is_file()
    assert load_morph(cache, key.model_copy(update={"younger_digest": "c" * 16})) is None


def test_write_morph_records_a_dissolve_fallback_with_an_all_zero_field(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("pipeline.morph.MAX_INVERSE_CONSISTENCY", 0.0)
    older = _write(tmp_path / "older.png", _plate(centre=(0.35, 0.5), radii=(0.2, 0.12)))
    younger = _write(tmp_path / "younger.png", _plate(centre=(0.6, 0.45), radii=(0.3, 0.15)))
    key = MorphKey(older="a", older_digest="a" * 16, younger="b", younger_digest="b" * 16)
    cache = tmp_path / "_morph"

    record = write_morph(cache, key, older, younger)

    assert record.fallback_dissolve is True
    directory = key.directory(cache)
    forward = decode_flow((directory / FORWARD_FLOW_NAME).read_bytes(), record.forward_range)
    backward = decode_flow((directory / BACKWARD_FLOW_NAME).read_bytes(), record.backward_range)
    assert np.abs(forward).max() == 0.0
    assert np.abs(backward).max() == 0.0


def test_write_morph_forces_a_dissolve_for_a_listed_pair_regardless_of_the_flow(
    tmp_path: Path,
) -> None:
    """A pair in `FORCED_DISSOLVE_PAIRS` dissolves even when the flow itself would pass the
    inverse-consistency gate (queue item 14 QA, 2026-09-16: the statistic cannot separate a
    translucent, radially-symmetric subject's ghosting from a clean pair at any threshold)."""
    older_id, younger_id = next(iter(FORCED_DISSOLVE_PAIRS))
    # The same well-matched plates the cached-textures test above uses, which score well under
    # MAX_INVERSE_CONSISTENCY on their own -- only the id override should force the dissolve.
    older = _write(tmp_path / "older.png", _plate(centre=(0.45, 0.5), radii=(0.2, 0.12)))
    younger = _write(tmp_path / "younger.png", _plate(centre=(0.52, 0.5), radii=(0.22, 0.13)))
    key = MorphKey(
        older=older_id, older_digest="a" * 16, younger=younger_id, younger_digest="b" * 16
    )
    cache = tmp_path / "_morph"

    record = write_morph(cache, key, older, younger)

    assert record.fallback_dissolve is True
    directory = key.directory(cache)
    forward = decode_flow((directory / FORWARD_FLOW_NAME).read_bytes(), record.forward_range)
    backward = decode_flow((directory / BACKWARD_FLOW_NAME).read_bytes(), record.backward_range)
    assert np.abs(forward).max() == 0.0
    assert np.abs(backward).max() == 0.0
