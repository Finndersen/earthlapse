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

from pydantic import BaseModel, Field, field_validator, model_validator

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


class Gap(BaseModel):
    """An open interval with no data, spanning exactly one pair of adjacent samples in a
    `TimeSeries` (post-sort). ADR-027.

    Adjacency is structural (`to_index == from_index + 1`) rather than re-derived from ages:
    a gap that skipped a sample, spanned zero or several sample pairs, or drifted off a real
    sample boundary through float rounding cannot be constructed at all, so `TimeSeries` does
    not need to re-check "bounded by two adjacent samples, nothing strictly inside" every time
    it reads one -- the type only holds values where that is already true.
    """

    from_index: int = Field(ge=0)
    to_index: int = Field(ge=1)

    @model_validator(mode="after")
    def _adjacent(self) -> Self:
        if self.to_index != self.from_index + 1:
            raise ValueError(
                f"gap ({self.from_index}, {self.to_index}): to_index must be from_index + 1"
            )
        return self


class TimeSeries(BaseModel):
    """A scalar quantity over time. Feeds WorldState fields and HUD sparklines."""

    id: str
    unit: str
    interpolation: Interpolation
    samples: list[Sample]
    # Ordered, non-overlapping (ADR-027). Default empty: most series have no declared gap.
    gaps: list[Gap] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        if not self.samples:
            raise ValueError(f"{self.id}: empty TimeSeries")
        self.samples.sort(key=lambda s: s.t)
        return self

    @model_validator(mode="after")
    def _gaps_valid(self) -> Self:
        sample_count = len(self.samples)
        self.gaps.sort(key=lambda g: g.from_index)
        previous_to_index = -1
        for gap in self.gaps:
            if gap.to_index >= sample_count:
                raise ValueError(
                    f"{self.id}: gap to_index {gap.to_index} out of range for "
                    f"{sample_count} samples"
                )
            if gap.from_index < previous_to_index:
                raise ValueError(f"{self.id}: gaps overlap at sample index {gap.from_index}")
            previous_to_index = gap.to_index
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
        if self._in_gap(i - 1, i):
            return None
        a, b = self.samples[i - 1], self.samples[i]
        return _blend(a.value, b.value, (t - a.t) / (b.t - a.t), self.interpolation)

    def _in_gap(self, from_index: int, to_index: int) -> bool:
        return any(g.from_index == from_index and g.to_index == to_index for g in self.gaps)


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


class GlobeEffectKind(StrEnum):
    """An additive globe visual keyed to an event (docs/GLOBE.md §6, ADR-013). Closed — a new
    kind is a new visual and needs its own envelope curve in `web/src/globe/effects/`, so it
    is a code change on both sides, not a free-text label.

    Twinned exactly in `web/src/types/layer.ts`'s `GlobeEffectKind` — the string values are
    the wire values too, so nothing translates them at the manifest boundary.
    """

    IMPACT_WINTER = "impact-winter"
    GIANT_IMPACT = "giant-impact"
    FLOOD_BASALT = "flood-basalt"
    ICE_SHELL = "ice-shell"
    REGIME_MAGMA_OCEAN = "regime-magma-ocean"
    REGIME_WATER_WORLD = "regime-water-world"
    REGIME_ARCHEAN = "regime-archean"
    REGIME_UNKNOWN_GEOGRAPHY = "regime-unknown-geography"


class EffectAnchor(BaseModel):
    """A present-day location; the globe reconstructs it to `t` with the plate model at build
    time (docs/GLOBE.md §5.3). Absent for effects with no fixed location (a regime, a giant
    impact with no claimed site)."""

    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)


class EffectWindow(BaseModel):
    """One active interval of a `GlobeEffect`. Distinct from the owning `Event`'s own
    `t_min`/`t_max`: one event can drive several disjoint windows — Snowball Earth's Sturtian
    and Marinoan glaciations are one `snowball-earth` event with two `ice-shell` windows
    (docs/GLOBE.md §4.3)."""

    t_min: GeoTime  # nearer the present
    t_max: GeoTime  # further into the past

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.t_min > self.t_max:
            raise ValueError(f"effect window: t_min {self.t_min} > t_max {self.t_max}")
        return self


class GlobeEffect(BaseModel):
    """An optional, additive globe effect on an `Event` (docs/GLOBE.md §6, ADR-013). An event
    without a timeline presence — a pre-1 Ga regime — carries this same field on an `Event` in
    the separate `globe-regimes` `EventSet` instead of `events-core`, rather than a bespoke
    table: every effect already has a date interval and a citation because it already is an
    event.

    Additive: `Event.effect` defaults to `None`, so a manifest written before this field
    existed stays valid.
    """

    kind: GlobeEffectKind
    anchor: EffectAnchor | None = None
    windows: list[EffectWindow] = Field(min_length=1)


class EventKind(StrEnum):
    """ADR-022. Which of two things an `Event`'s `t_min`/`t_max` interval means — the two were
    previously conflated in one interval with no way to tell them apart (a dating error bar on
    one happening vs. a literature-quoted span of something that genuinely lasted), which is
    exactly how a fossil-dating uncertainty on the seaweed event was once misread by the
    timeline as 200 Myr of continuous seaweed."""

    MOMENT = "moment"  # one happening; t is the best estimate, [t_min, t_max] its dating error
    PERIOD = "period"  # genuinely lasted; t_min/t_max are its own end/start, no single instant


class EventTag(StrEnum):
    """ADR-022. Closed set of six themes, science and technology combined. Multiple tags may
    apply to one event; the first is its primary tag and drives timeline colour (a later task).
    Stringly-typed free text was rejected for this precisely because an unknown value here must
    be a loud validation error, not a silently-dropped filter match."""

    LIFE = "life"
    EARTH_CLIMATE = "earth-climate"
    CATASTROPHE = "catastrophe"
    HUMAN_ORIGINS = "human-origins"
    SOCIETY = "society"
    SCIENCE_TECHNOLOGY = "science-technology"


class Event(BaseModel):
    """A labelled moment or period. `t_min`/`t_max` is a real interval, not decoration — most
    deep-time dates are contested and the UI renders the band. `kind` (ADR-022) says which of
    two things that interval means: a dating uncertainty around one happening (`kind='moment'`,
    with `t` the best-estimate instant), or the known span of something that genuinely lasted
    (`kind='period'`, no single instant)."""

    id: str
    label: str
    kind: EventKind
    t_min: GeoTime  # nearer the present
    t_max: GeoTime  # further into the past
    # Best-estimate instant for a moment; None for a period, whose own t_min/t_max already are
    # its span. Not necessarily the interval's midpoint -- a citation may support a sharper date.
    t: GeoTime | None = None
    # Closed set (EventTag), ADR-022. Non-empty; first tag is primary and drives timeline colour.
    tags: tuple[EventTag, ...] = Field(min_length=1)
    importance: float = Field(ge=0.0, le=1.0)
    description: str
    citation: str
    effect: GlobeEffect | None = None

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.t_min > self.t_max:
            raise ValueError(f"{self.id}: t_min {self.t_min} > t_max {self.t_max}")
        return self

    @model_validator(mode="after")
    def _kind_and_t_consistent(self) -> Self:
        if self.kind is EventKind.MOMENT:
            if self.t is None:
                raise ValueError(f"{self.id}: kind=moment requires t (best-estimate date)")
            if not (self.t_min <= self.t <= self.t_max):
                raise ValueError(
                    f"{self.id}: t={self.t} outside [t_min, t_max]=[{self.t_min}, {self.t_max}]"
                )
        elif self.t is not None:
            raise ValueError(f"{self.id}: kind=period must not set t; t_min/t_max are its span")
        return self

    @field_validator("tags")
    @classmethod
    def _tags_no_duplicates(cls, tags: tuple[EventTag, ...]) -> tuple[EventTag, ...]:
        if len(set(tags)) != len(tags):
            raise ValueError(f"duplicate tags: {tags}")
        return tags

    @property
    def placement_t(self) -> GeoTime:
        """Best single point for placement/sorting: a moment's own best-estimate `t`, else the
        interval's midpoint. Never present this as the date -- several period midpoints
        (`ediacaran-biota`, `control-of-fire`) fall in the middle of a real span or a genuine
        scientific disagreement, not at a meaningful instant."""
        return self.t if self.t is not None else (self.t_min + self.t_max) / 2


class EventSet(BaseModel):
    id: str
    events: list[Event]

    @model_validator(mode="after")
    def _sorted(self) -> Self:
        self.events.sort(key=lambda e: e.placement_t)
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
