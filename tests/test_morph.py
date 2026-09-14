"""Portrait morph fields from synthetic plates. Needs the optional `morph` extra (OpenCV)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

cv2 = pytest.importorskip("cv2")

from pipeline.flowfield import FLOW_TEXTURE_SIZE, SubjectBox, decode_flow, texel_centres
from pipeline.morph import (
    MAX_FLOW_P95,
    MAX_MORPH_ZOOM,
    SUBJECT_FILL,
    MorphError,
    bounded_fills,
    compute_morph,
    detect_subject_box,
    load_plate,
    refuse_bursting_flow,
    write_morph,
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


def _plate(centre: tuple[float, float], radii: tuple[float, float]) -> np.ndarray:
    """A dark backdrop, a striped bright ellipse for a subject, and a thin scale bar."""
    size = PLATE_SIZE
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) / size
    inside = ((x - centre[0]) / radii[0]) ** 2 + ((y - centre[1]) / radii[1]) ** 2 <= 1
    local_u = (x - centre[0]) / radii[0]
    local_v = (y - centre[1]) / radii[1]
    texture = 150 + 60 * np.sin(local_u * 9) * np.cos(local_v * 7)
    plate = np.full((size, size), 12.0)
    plate[inside] = texture[inside]
    bar_top = int(size * 0.9)
    plate[bar_top : bar_top + 2, int(size * 0.12) : int(size * 0.3)] = 180
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
    older = _plate(centre=(0.35, 0.5), radii=(0.2, 0.12))
    younger = _plate(centre=(0.6, 0.45), radii=(0.3, 0.15))

    morph = compute_morph(older, younger)

    assert morph.forward.shape == morph.backward.shape == (FLOW_TEXTURE_SIZE, FLOW_TEXTURE_SIZE, 2)
    for source, target, field in (
        (older, younger, morph.forward),
        (younger, older, morph.backward),
    ):
        assert _warp_error(source, target, field) < 0.35 * _warp_error(
            source, target, np.zeros_like(field)
        )


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
    older = _write(tmp_path / "older.png", _plate(centre=(0.35, 0.5), radii=(0.2, 0.12)))
    younger = _write(tmp_path / "younger.png", _plate(centre=(0.6, 0.45), radii=(0.3, 0.15)))
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
