from pipeline.stage_pins import IndexChanges, plan_index_changes


def test_adds_every_pin_and_removes_tracked_candidates_no_longer_pinned() -> None:
    pinned = {"data/candidates/b/d2/01-b.jpg", "data/candidates/a/d1/02-a.jpg"}
    tracked = {"data/candidates/a/d1/02-a.jpg", "data/candidates/a/d0/01-old.jpg"}

    assert plan_index_changes(pinned, tracked) == IndexChanges(
        add=("data/candidates/a/d1/02-a.jpg", "data/candidates/b/d2/01-b.jpg"),
        remove=("data/candidates/a/d0/01-old.jpg",),
    )


def test_nothing_tracked_yet_adds_all_pins_and_removes_nothing() -> None:
    pinned = {"data/candidates/a/d1/01-a.jpg"}

    assert plan_index_changes(pinned, set()) == IndexChanges(
        add=("data/candidates/a/d1/01-a.jpg",), remove=()
    )
