"""Scene records: data/scenes.yaml, the curated source of truth for what gets generated.

A scene is one still at one `t`. A chapter is a held composition (DESIGN §6): consecutive
scenes in the same chapter share framing, so the viewer's dissolve between them reads as the
world morphing rather than a cut. A chapter may recur as several non-adjacent **runs** across
the timeline (ADR-020) — each run is its own consecutive stretch of scenes, and every run of
the same chapter shares that chapter's shot and composition, but a run's neighbours in a
*different* chapter still read as a cut at each boundary. The pin a human writes with
`earthtime review pick` lives here too, so it survives every rebuild (ADR-005).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from pipeline.prompts import Composition, SceneSubject, Shot, UnsourcedConditions
from pipeline.shapes import GeoTime

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"


class UnknownScene(LookupError):
    """A scene id that data/scenes.yaml does not define."""


class ScenePin(BaseModel):
    """A human-approved candidate: the stored image's content digest and its project path."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    asset_digest: str = Field(pattern=r"^[0-9a-f]{16}$")
    path: str = Field(min_length=1)


class ChapterRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=SLUG_PATTERN)
    label: str = Field(min_length=1)
    shot: Shot
    composition: Composition


class SceneRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=SLUG_PATTERN)
    t: GeoTime = Field(ge=0)
    chapter: str
    shot: Shot
    caption: str = Field(min_length=1)
    unsourced: UnsourcedConditions
    subject: SceneSubject
    pin: ScenePin | None


class SceneBook(BaseModel):
    """Every chapter and scene. Scenes are held ascending in `t` (present first), like the shapes."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    chapters: tuple[ChapterRecord, ...] = Field(min_length=1)
    scenes: tuple[SceneRecord, ...] = Field(min_length=1)

    @field_validator("scenes")
    @classmethod
    def _sorted(cls, scenes: tuple[SceneRecord, ...]) -> tuple[SceneRecord, ...]:
        return tuple(sorted(scenes, key=lambda s: s.t))

    @model_validator(mode="after")
    def _consistent(self) -> SceneBook:
        _require_unique("chapter id", [c.id for c in self.chapters])
        _require_unique("scene id", [s.id for s in self.scenes])
        _require_unique("scene t", [s.t for s in self.scenes])
        chapters = {c.id: c for c in self.chapters}
        for scene in self.scenes:
            chapter = chapters.get(scene.chapter)
            if chapter is None:
                raise ValueError(f"{scene.id}: unknown chapter {scene.chapter!r}")
            if scene.shot is not chapter.shot:
                raise ValueError(
                    f"{scene.id}: shot {scene.shot} differs from chapter {chapter.id} "
                    f"shot {chapter.shot}; a chapter holds one composition"
                )
        # A chapter may recur as several non-adjacent runs (ADR-020): each maximal stretch of
        # consecutive same-chapter scenes is one run, but the same chapter id may appear in more
        # than one such stretch. Every run still gets its own span in the published manifest
        # (`pipeline/publish.py`'s `chapter_spans`, which groups by adjacency the same way), so
        # no chapter-run uniqueness is enforced here — only that every chapter has at least one.
        runs = [
            scene.chapter
            for i, scene in enumerate(self.scenes)
            if i == 0 or scene.chapter != self.scenes[i - 1].chapter
        ]
        unused = chapters.keys() - set(runs)
        if unused:
            raise ValueError(f"chapters with no scenes: {sorted(unused)}")
        return self

    def chapter(self, chapter_id: str) -> ChapterRecord:
        for chapter in self.chapters:
            if chapter.id == chapter_id:
                return chapter
        raise LookupError(f"unknown chapter {chapter_id!r}")

    def scene(self, scene_id: str) -> SceneRecord:
        for scene in self.scenes:
            if scene.id == scene_id:
                return scene
        raise UnknownScene(f"unknown scene {scene_id!r}")

    def chronological(self) -> tuple[SceneRecord, ...]:
        """Oldest first: the order a story, and a review of adjacent pairs, reads in."""
        return tuple(reversed(self.scenes))

    def neighbours(self, scene_id: str) -> tuple[SceneRecord | None, SceneRecord | None]:
        """(predecessor, successor) in time: the next older scene and the next younger one."""
        order = self.chronological()
        index = order.index(self.scene(scene_id))
        predecessor = order[index - 1] if index > 0 else None
        successor = order[index + 1] if index + 1 < len(order) else None
        return predecessor, successor


def _require_unique(what: str, values: Sequence[str | float]) -> None:
    duplicates = sorted(str(value) for value, count in Counter(values).items() if count > 1)
    if duplicates:
        raise ValueError(f"duplicate {what}: {', '.join(duplicates)}")


def load_scene_book(path: Path) -> SceneBook:
    return parse_scene_book(path.read_text())


def parse_scene_book(text: str) -> SceneBook:
    return SceneBook.model_validate(yaml.safe_load(text))


def write_pin(path: Path, scene_id: str, pin: ScenePin | None) -> SceneBook:
    """Rewrite one scene's `pin:` line in place, keeping every comment in the file.

    The patched text is parsed and checked before it is written, so a file this cannot edit
    safely is refused rather than corrupted.
    """
    text = path.read_text()
    patched = patch_pin_line(text, scene_id, pin)
    book = parse_scene_book(patched)
    if book.scene(scene_id).pin != pin:
        raise AssertionError(f"{scene_id}: pin did not round-trip through {path}")
    path.write_text(patched)
    return book


_RECORD_START = re.compile(r"^\s*-\s+id:\s*(?P<id>\S+)\s*$")
_PIN_LINE = re.compile(r"^(?P<indent>\s+)pin:.*$")


def patch_pin_line(text: str, record_id: str, pin: ScenePin | None) -> str:
    """Replace the single-line `pin:` of the `- id: <record_id>` record in a YAML list of records.

    Shared by data/scenes.yaml and data/portraits.yaml. Callers have already resolved the id
    against the parsed book, so a missing or repeated record here is a malformed file.
    """
    lines = text.splitlines(keepends=True)
    record_ids = {
        i: match["id"] for i, line in enumerate(lines) if (match := _RECORD_START.match(line))
    }
    matching = [i for i, found in record_ids.items() if found == record_id]
    if len(matching) != 1:
        raise ValueError(f"expected one record with id {record_id!r}, found {len(matching)}")
    start = matching[0]
    end = next((i for i in record_ids if i > start), len(lines))
    pin_lines = {
        i: match["indent"] for i in range(start, end) if (match := _PIN_LINE.match(lines[i]))
    }
    if len(pin_lines) != 1:
        raise ValueError(f"{record_id}: expected exactly one single-line `pin:` entry")
    ((index, indent),) = pin_lines.items()
    lines[index] = f"{indent}pin: {_pin_value(pin)}\n"
    return "".join(lines)


def _pin_value(pin: ScenePin | None) -> str:
    if pin is None:
        return "null"
    return f"{{asset_digest: {json.dumps(pin.asset_digest)}, path: {json.dumps(pin.path)}}}"
