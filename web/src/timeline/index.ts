/**
 * web/src/timeline — the warped time axis (DESIGN §3): scales, LOD, playback and the
 * `<Timeline>` control itself. Prop-driven throughout; nothing here imports the zustand store
 * (W11) or reads anything but its arguments.
 *
 * The visible window is the selected **era section**'s (`sections.ts`, ADR-024): the full domain,
 * `[0, EARTH_FORMATION]`, at the root, or a named eon, era, period, epoch or Holocene
 * human-history section below it. There is no free zoom or pan (removed in ADR-021; DESIGN §3).
 * Within a window, resolving events or checkpoints that sit close together in time is the job
 * of the density-adaptive fisheye lens (`fisheye.ts`/`useFisheye.ts`, ADR-017 and its
 * amendments), which stretches the region under the pointer so nearby markers spread apart on
 * hover.
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
 * - `createSymlogScale(window)` — `log(1 + t / knee)`. See `SYMLOG_C`'s doc comment in scale.ts
 *   for why the break-point sits at 10,000 years at the full domain: it is the largest value
 *   that keeps the whole Holocene inside the near-linear region, so recorded history stays a
 *   legible band of the axis even at the full domain. Below `KNEE_ADAPTIVE_SPAN_THRESHOLD`
 *   (ADR-024 amendment, follow-up pass item 7) the knee shrinks with the window's own span
 *   instead of staying fixed, so a narrow section's own children — the Holocene's, in
 *   particular — get the same kind of room the Holocene itself gets at the full domain, rather
 *   than reading as flat proportional slivers.
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
 *   present, clamped at the present. Two modes (`playback.mode`): `'scenes'` (default, ADR-016)
 *   walks `scenesPacing` (`scene/pacing.ts`'s `scenePlaybackSegments`, structurally a
 *   `PlaybackPacingSegment[]`) on the full-domain symlog scale at exactly the velocity that spends
 *   each segment's `durationSeconds / speed`; `'steady'` (ADR-050) moves at a literal
 *   `playback.yearsPerSecond`. The playback loop calls `advanceSteadyPlayhead(t, dt, playback,
 *   sceneTerritories?)` for steady mode, which additionally slows the rate inside any scene
 *   territory (`SteadySceneTerritory[]`, structurally `scene/steadyPacing.ts`'s
 *   `sceneTerritories(scenes)`) that would otherwise dwell under `MIN_CUT_DWELL_SECONDS` — a
 *   photosensitivity safety floor (ADR-029). `usePlaybackLoop` drives either off
 *   `requestAnimationFrame`. `playbackRates.ts` holds each mode's detents, the `[`/`]` step rule
 *   and `defaultSteadyRate`, the context default on entering steady mode.
 * - `formatGeoTime(t)` renders a `GeoTime` for humans (`"4.57 Ga"`, `"66 Ma"`, `"11.7 ka"`,
 *   `"250 years ago"`, `"present"`); `formatTimeRange(window)` does the same for a whole window
 *   (`"12 ka – present"`, `"252–201 Ma"`) — both exported for other packages that need to print
 *   a time without the rest of the timeline UI. `formatGeoTimePrecise(t, precisionYears)`
 *   (ADR-021) is `formatGeoTime` with extra decimal digits once `precisionYears` — the local
 *   years-per-displayed-pixel, e.g. `yearsPerDisplayedPixelAt` in `fisheye.ts` — is finer than
 *   what the plain bucket already resolves; `ScrubTrack`'s pointer-driven readouts use it so a
 *   1px move inside a fisheye-resolved gap visibly changes the reading.
 * - Era sections (`sections.ts`, ADR-024): one fixed tree of `TimelineSection`s (ICS v2024/12
 *   boundaries, plus cited Holocene human-history sections). The pure navigation functions:
 *   `sectionById`, `childSections`, `sectionPath` (the breadcrumb), `childSectionAt`/`sectionAt`,
 *   `nextSibling`, `continuationSection` (where playback goes past a section's end),
 *   `sectionFollowingT` (the section to show once `t` moves, which the time store applies on
 *   every `setT`) and `sectionEntryT` (`t` after selecting a section). `eraNameForTime(t)` is
 *   the top-level name, for the shell's era/time title. `interpolateWindow` (scale.ts) eases a
 *   window change in symlog-warped space, and `useAnimatedScale` animates both that and the
 *   scale-kind toggle. `ERA_SHORTCUTS`/`isEraShortcutActive` (`eraShortcuts.ts`) back
 *   `<Timeline>`'s own always-visible Earth/Dinosaurs/Humans shortcut group (`components/
 *   EraShortcuts.tsx`) — plain nicknames for three existing sections (the root, the Mesozoic,
 *   the Holocene), never a new node or window.
 * - `timelineKeyIntent(event)` maps a keydown to a `TimelineKeyIntent` (or `null`), ignoring
 *   text-input targets. It is the pure half of `Timeline`'s keyboard handling: stepping (←/→),
 *   play/pause (space) and leaving the current section for its parent (Escape, ADR-024).
 * - `TimelineCheckpoint` (W13) — a generated still, plotted on the scrub track as a pip,
 *   distinct from data-driven `TimelineEvent`s: no importance/LOD, so `visibleCheckpoints` is a
 *   plain window-overlap filter. `layoutCheckpointPips` positions every checkpoint and (when
 *   several would render within `MIN_PIP_SEPARATION_PX` of each other) merges them into one
 *   `CheckpointClusterLayout` marker instead of stacking rows (ADR-019) — a checkpoint is never
 *   hidden, only merged; clicking a cluster reports its members via `Timeline`'s `onOpenCluster`
 *   rather than framing them (there is no window left to frame into). `nearestNeighbourCheckpoint`
 *   and `nearestStepTarget` (checkpoints only — events are not step targets) back the transport's
 *   step buttons and the ←/→ shortcut, so every checkpoint is reachable by stepping regardless of
 *   clustering.
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
export { ERA_SHORTCUTS, isEraShortcutActive, type EraShortcut } from './eraShortcuts'
export { formatCalendarYear, formatGeoTime, formatGeoTimePrecise, formatRate, formatTimeRange } from './format'
export { isOpenEventBrowserShortcut, timelineKeyIntent, type TimelineKeyEvent, type TimelineKeyIntent } from './keyboard'
export { nearestNeighbourEvent, type EventStepDirection } from './lod'
export {
  advancePlayhead,
  advanceSteadyPlayhead,
  usePlaybackLoop,
  type PlaybackPacingSegment,
  type SteadySceneTerritory,
} from './playback'
export {
  activeRate,
  defaultSteadyRate,
  rateDetents,
  SCENES_SPEEDS,
  STEADY_RATES,
  stepActiveRate,
  withActiveRate,
} from './playbackRates'
export {
  blendScales,
  createLinearScale,
  createSymlogScale,
  interpolateWindow,
  SYMLOG_C,
  type TimeWindow,
} from './scale'
export {
  childSectionAt,
  childSections,
  continuationSection,
  eraNameForTime,
  nextSibling,
  parentSection,
  ROOT_SECTION_ID,
  sectionAt,
  sectionById,
  sectionContains,
  sectionEntryT,
  sectionFollowingT,
  sectionPath,
  sectionSymlogKnee,
  type SectionId,
  type TimelineSection,
} from './sections'
export { generateTicks, tickLabelAlign, type AxisTick, type TickLabelAlign } from './ticks'
export { EraShortcuts } from './components/EraShortcuts'
export { Timeline, type TimelineProps } from './Timeline'
export { useAnimatedScale } from './useAnimatedScale'
export { usePrefersReducedMotion } from './usePrefersReducedMotion'
