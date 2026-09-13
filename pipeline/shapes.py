"""The four curated data shapes. NORMATIVE — see docs/DATA_SOURCES.md.

Every data source normalises into exactly one of these. Adding a fifth requires an ADR.

Time convention
---------------
`t` is **years before present**, a positive float increasing into the past. Present is 0.0,
Earth's formation is ~4.6e9. There are no calendar dates anywhere below the UI layer.

All sequences are stored **sorted ascending in t** — present first, deepest last — and
validators enforce this on construction, so source authors may write records in any order.
Every lookup is a `bisect` on that invariant.
"""

from __future__ import annotations

import bisect
import math
from enum import StrEnum
from typing import Protocol, Self, runtime_checkable

from pydantic import BaseModel, Field, model_validator

GeoTime = float
"""Years before present. Positive into the past. Present = 0.0."""

EARTH_FORMATION: GeoTime = 4.567e9


class Interpolation(StrEnum):
    """How to read between two samples. Declared per source, never inferred.

    A wrong choice here produces subtly wrong charts that nobody notices, which is why
    it is a required field rather than a default.
    """

    LINEAR = "linear"
    LOG_LINEAR = "log-linear"  # linear in log(value) — correct for CO2, populations
    STEP = "step"  # hold previous value — correct for discrete regimes
    NEAREST = "nearest"


@runtime_checkable
class Sampler(Protocol):
    """Everything the runtime reads is a pure function of t."""

    def sample(self, t: GeoTime): ...

    @property
    def domain(self) -> tuple[GeoTime, GeoTime]:
        """(newest, oldest) in years BP. Outside this, sample() returns None."""
        ...


# --------------------------------------------------------------------------- TimeSeries


class Sample(BaseModel):
    t: GeoTime
    value: float
    lower: float | None = None
    upper: float | None = None


class TimeSeries(BaseModel):
    """A scalar quantity over time. Feeds WorldState fields and HUD sparklines."""

    id: str
    unit: str
    interpolation: Interpolation
    samples: list[Sample]

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        if not self.samples:
            raise ValueError(f"{self.id}: empty TimeSeries")
        self.samples.sort(key=lambda s: s.t)
        return self

    @property
    def domain(self) -> tuple[GeoTime, GeoTime]:
        return self.samples[0].t, self.samples[-1].t

    def sample(self, t: GeoTime) -> float | None:
        lo, hi = self.domain
        if not lo <= t <= hi:
            return None
        ts = [s.t for s in self.samples]
        i = bisect.bisect_left(ts, t)
        if i < len(ts) and ts[i] == t:
            return self.samples[i].value
        a, b = self.samples[i - 1], self.samples[i]
        return _blend(a.value, b.value, (t - a.t) / (b.t - a.t), self.interpolation)


def _blend(a: float, b: float, f: float, how: Interpolation) -> float:
    match how:
        case Interpolation.LINEAR:
            return a + (b - a) * f
        case Interpolation.LOG_LINEAR:
            if a <= 0 or b <= 0:
                return a + (b - a) * f  # degrade gracefully rather than raise
            return math.exp(math.log(a) + (math.log(b) - math.log(a)) * f)
        case Interpolation.STEP:
            return a
        case Interpolation.NEAREST:
            return a if f < 0.5 else b


# ----------------------------------------------------------------------------- EventSet


class Event(BaseModel):
    """A labelled moment. `t_min`/`t_max` is a real interval, not decoration —
    most deep-time dates are contested and the UI renders the band."""

    id: str
    label: str
    t_min: GeoTime  # nearer the present
    t_max: GeoTime  # further into the past
    importance: float = Field(ge=0.0, le=1.0)
    description: str
    citation: str

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.t_min > self.t_max:
            raise ValueError(f"{self.id}: t_min {self.t_min} > t_max {self.t_max}")
        return self

    @property
    def t(self) -> GeoTime:
        """Midpoint, for placement. Never present this as the date."""
        return (self.t_min + self.t_max) / 2


class EventSet(BaseModel):
    id: str
    events: list[Event]

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        self.events.sort(key=lambda e: e.t)
        return self

    @property
    def domain(self) -> tuple[GeoTime, GeoTime]:
        return self.events[0].t_min, self.events[-1].t_max

    def sample(self, t: GeoTime) -> list[Event]:
        """Events whose uncertainty interval contains t."""
        return [e for e in self.events if e.t_min <= t <= e.t_max]

    def window(self, newest: GeoTime, oldest: GeoTime, min_importance: float = 0.0) -> list[Event]:
        """Events overlapping a visible span, filtered by zoom LOD threshold."""
        return [
            e
            for e in self.events
            if e.t_max >= newest and e.t_min <= oldest and e.importance >= min_importance
        ]


# ----------------------------------------------------------------------- RasterSequence


class RasterFrame(BaseModel):
    t: GeoTime
    ref: str  # published path, resolved against the manifest's asset base


class RasterBlend(BaseModel):
    """Two bracketing frames plus a mix factor. The globe cross-fades these, which is
    what makes continental drift continuous rather than a slideshow of epochs."""

    before: str  # nearer the present
    after: str  # further into the past
    alpha: float = Field(ge=0.0, le=1.0)  # 0 -> before, 1 -> after


class RasterSequence(BaseModel):
    id: str
    frames: list[RasterFrame]

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        if not self.frames:
            raise ValueError(f"{self.id}: empty RasterSequence")
        self.frames.sort(key=lambda f: f.t)
        return self

    @property
    def domain(self) -> tuple[GeoTime, GeoTime]:
        return self.frames[0].t, self.frames[-1].t

    def sample(self, t: GeoTime) -> RasterBlend | None:
        lo, hi = self.domain
        if not lo <= t <= hi:
            return None
        ts = [f.t for f in self.frames]
        i = bisect.bisect_left(ts, t)
        if i < len(ts) and ts[i] == t:
            return RasterBlend(before=self.frames[i].ref, after=self.frames[i].ref, alpha=0.0)
        a, b = self.frames[i - 1], self.frames[i]
        return RasterBlend(before=a.ref, after=b.ref, alpha=(t - a.t) / (b.t - a.t))


# --------------------------------------------------------------------------------- Tree


class TreeNode(BaseModel):
    id: str
    parent: str | None
    label: str
    t_divergence: GeoTime
    representative: str | None = None  # e.g. "Tiktaalik"
    note: str | None = None
    citation: str | None = None


class Tree(BaseModel):
    """A dated lineage. Used for the ancestor layer — a path, not a full phylogeny."""

    id: str
    nodes: list[TreeNode]

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        if not self.nodes:
            raise ValueError(f"{self.id}: empty Tree")
        self.nodes.sort(key=lambda n: n.t_divergence)
        ids = {n.id for n in self.nodes}
        for n in self.nodes:
            if n.parent is not None and n.parent not in ids:
                raise ValueError(f"{self.id}: node {n.id} has unknown parent {n.parent}")
        return self

    @property
    def domain(self) -> tuple[GeoTime, GeoTime]:
        return self.nodes[0].t_divergence, self.nodes[-1].t_divergence

    def sample(self, t: GeoTime) -> TreeNode | None:
        """The most recent node that had already diverged by time t — i.e. the ancestor
        alive at t. Returns None before the root."""
        ts = [n.t_divergence for n in self.nodes]
        i = bisect.bisect_left(ts, t)
        return self.nodes[i] if i < len(self.nodes) else None

    def path_to(self, node_id: str) -> list[TreeNode]:
        by_id = {n.id: n for n in self.nodes}
        out, cur = [], by_id.get(node_id)
        while cur is not None:
            out.append(cur)
            cur = by_id.get(cur.parent) if cur.parent else None
        return list(reversed(out))


CuratedShape = TimeSeries | EventSet | RasterSequence | Tree
