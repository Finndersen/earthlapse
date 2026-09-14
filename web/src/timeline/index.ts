/**
 * web/src/timeline — the warped time axis (DESIGN §3): scales, LOD, playback and the
 * `<Timeline>` control itself. Prop-driven throughout; nothing here imports the zustand store
 * (W11) or reads anything but its arguments.
 *
 * The visible window is always the full domain, `[0, EARTH_FORMATION]` — there is no zoom or
 * pan (removed; DESIGN §3's v1 note has the full rationale). Resolving events or checkpoints
 * that sit close together in time is instead the job of the density-adaptive fisheye lens
 * (`fisheye.ts`/`useFisheye.ts`, ADR-017 and its amendments), which stretches the region under
 * the pointer so nearby markers spread apart on hover.
 *
 * ## Orientation (applies to every `TimeScale` this package produces)
 *
 * A visible window is `TimeWindow = [newest, oldest]`, years BP, `newest <= oldest`, both
 * within `[0, EARTH_FORMATION]`. Every `TimeScale.toUnit`/`fromUnit` maps that window onto
 * `u` in `[0, 1]` with **`u = 0` at the OLDEST edge (left) and `u = 1` at the NEWEST edge
 * (right)** — screen-left-to-right runs deep-past-to-present, matching how every axis and
 * transport control in this package reads. `toUnit` is therefore monotonically *decreasing*
 * in `t`; `fromUnit` is its inverse.
 *
 * ## Scales
 *
 * - `createSymlogScale(window)` — `log(1 + t / SYMLOG_C)`. See `SYMLOG_C`'s doc comment in
 *   scale.ts for why the break-point sits at 10,000 years: it is the largest value that keeps
 *   the whole Holocene inside the near-linear region, so recorded history stays a legible
 *   band of the axis even at the full domain.
 * - `createLinearScale(window)` — true proportional. Deliberately near-useless at the full
 *   domain (DESIGN §3): human history collapses to sub-pixel width. That collapse, animated
 *   via `blendScales`/`useAnimatedScale`, is a deliberate product feature, not a bug to design
 *   around.
 * - `blendScales(a, b, k)` — animates between two same-domain scales; `fromUnit` inverts the
 *   blended (closed-form-free) mapping by bisection.
 * - **`density` is out of scope for this package.** `Timeline`'s `scaleKind` prop accepts only
 *   `'symlog' | 'linear'`.
 *
 * ## LOD, playback
 *
 * - `declutterEvents(events, window, scale, trackWidthPx)` (ADR-019, superseding DESIGN §3's
 *   span-based importance-floor LOD for rendering) — every event overlapping `window` is a
 *   candidate; importance only breaks a collision between two whose displayed bands would
 *   otherwise overlap on screen. `nearestNeighbourEvent` (for stepping) reads every overlapping
 *   event directly, not this decluttered subset — a keyboard/transport user must always be able
 *   to reach an event that currently lost a room collision.
 * - `advancePlayhead(t, dtSeconds, playback, fullScale, scenesPacing?)` moves `t` toward the
 *   present in `fullScale`'s warped `u` (always the *full-domain* scale), scaled by
 *   `playback.speed`, clamped at the present. Two modes (ADR-016, `playback.mode`): `'scenes'`
 *   (default) walks `scenesPacing` (`scene/pacing.ts`'s `scenePlaybackSegments`, structurally a
 *   `PlaybackPacingSegment[]`) at exactly the velocity that spends each segment's
 *   `durationSeconds`, so scenes dwell and dissolves take their exact wall-clock time at 1x
 *   without the picture ever falling out of sync with `t`; `'steady'` ignores `scenesPacing`
 *   and moves at flat `baseRate * speed` throughout. The caller picks `fullScale` per mode —
 *   always full-domain symlog for `'scenes'`, the full-domain scale of the current `ScaleKind`
 *   for `'steady'`. `usePlaybackLoop` drives it off `requestAnimationFrame`.
 * - `formatGeoTime(t)` renders a `GeoTime` for humans (`"4.57 Ga"`, `"66 Ma"`, `"11.7 ka"`,
 *   `"250 years ago"`, `"present"`); `formatTimeRange(window)` does the same for a whole window
 *   (`"12 ka – present"`, `"252–201 Ma"`) — both exported for other packages that need to print
 *   a time without the rest of the timeline UI. `formatGeoTimePrecise(t, precisionYears)`
 *   (ADR-021) is `formatGeoTime` with extra decimal digits once `precisionYears` — the local
 *   years-per-displayed-pixel, e.g. `yearsPerDisplayedPixelAt` in `fisheye.ts` — is finer than
 *   what the plain bucket already resolves; `ScrubTrack`'s pointer-driven readouts use it so a
 *   1px move inside a fisheye-resolved gap visibly changes the reading.
 * - `ERA_BANDS` — the eon/era boundaries (ICS v2024/12). `eraNameForTime(t)` looks one up
 *   directly, for callers (the shell's era/time title) that just need the name.
 * - `timelineKeyIntent(event)` maps a keydown to a `TimelineKeyIntent` (or `null`), ignoring
 *   text-input targets — the pure half of `Timeline`'s keyboard handling. Only stepping
 *   (←/→) and play/pause (space) remain; zoom shortcuts were removed alongside zoom itself.
 * - `TimelineCheckpoint` (W13) — a generated still, plotted on the scrub track as a pip,
 *   distinct from data-driven `TimelineEvent`s: no importance/LOD, so `visibleCheckpoints` is a
 *   plain window-overlap filter. `layoutCheckpointPips` positions every checkpoint and (when
 *   several would render within `MIN_PIP_SEPARATION_PX` of each other) merges them into one
 *   `CheckpointClusterLayout` marker instead of stacking rows (ADR-019) — a checkpoint is never
 *   hidden, only merged; clicking a cluster reports its members via `Timeline`'s `onOpenCluster`
 *   rather than framing them (there is no window left to frame into). `nearestNeighbourCheckpoint`
 *   and the combined `nearestStepTarget` (events ∪ checkpoints) back the transport's step buttons
 *   and the ←/→ shortcut, so every checkpoint is reachable by stepping regardless of clustering.
 *
 * ## `<Timeline>` — props contract
 *
 * See the doc comment on `TimelineProps` in Timeline.tsx.
 */

export {
  layoutCheckpointPips,
  MIN_PIP_SEPARATION_PX,
  type CheckpointClusterLayout,
  type CheckpointLayoutEntry,
  type CheckpointPipLayout,
} from './checkpointLayout'
export {
  nearestNeighbourCheckpoint,
  nearestStepTarget,
  visibleCheckpoints,
  type TimelineCheckpoint,
} from './checkpoints'
export { declutterEvents, MIN_EVENT_GAP_PX, MIN_EVENT_MARKER_PX } from './declutter'
export { eraNameForTime, ERA_BANDS, type EraBand } from './eras'
export { formatGeoTime, formatGeoTimePrecise, formatRate, formatTimeRange } from './format'
export { timelineKeyIntent, type TimelineKeyEvent, type TimelineKeyIntent } from './keyboard'
export { nearestNeighbourEvent, type EventStepDirection } from './lod'
export { advancePlayhead, usePlaybackLoop, type PlaybackPacingSegment } from './playback'
export {
  blendScales,
  createLinearScale,
  createSymlogScale,
  SYMLOG_C,
  type TimeWindow,
} from './scale'
export { generateTicks, tickLabelAlign, type AxisTick, type TickLabelAlign } from './ticks'
export { Timeline, type TimelineProps } from './Timeline'
export { useAnimatedScale } from './useAnimatedScale'
export { usePrefersReducedMotion } from './usePrefersReducedMotion'
