/**
 * web/src/timeline — the warped time axis (DESIGN §3): scales, zoom, LOD, playback and the
 * `<Timeline>` control itself. Prop-driven throughout; nothing here imports the zustand store
 * (W11) or reads anything but its arguments.
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
 *   band of the axis even zoomed all the way out.
 * - `createLinearScale(window)` — true proportional. Deliberately near-useless at full
 *   zoom-out (DESIGN §3): human history collapses to sub-pixel width. That collapse, animated
 *   via `blendScales`/`useAnimatedScale`, is a deliberate product feature, not a bug to design
 *   around.
 * - `blendScales(a, b, k)` — animates between two same-domain scales; `fromUnit` inverts the
 *   blended (closed-form-free) mapping by bisection.
 * - **`density` is out of scope for this package.** `zoomWindow` and `Timeline`'s `scaleKind`
 *   prop accept only `'symlog' | 'linear'`; passing `'density'` to `zoomWindow` throws rather
 *   than silently doing something wrong.
 *
 * ## Zoom, pan, LOD, playback
 *
 * - `zoomWindow(window, anchorU, factor, scaleKind)` zooms around the cursor in warped space,
 *   clamped to `[0, EARTH_FORMATION]` and to a span of `[MIN_SPAN_YEARS, EARTH_FORMATION]`.
 * - `panWindow(window, deltaU, scaleKind)` slides the window without resizing it — shift+wheel
 *   / horizontal wheel on the scrub track.
 * - `frameEventWindow(tMin, tMax)` — the window that frames an event's uncertainty band plus
 *   padding (double-clicking a marker).
 * - `minImportanceForSpan(spanYears)` / `visibleEvents(events, window, spanYears)` — the 1D
 *   quadtree LOD (DESIGN §3): a wider visible span raises the importance floor for which
 *   events are drawn. `nearestNeighbourEvent` finds the next one in a direction (the
 *   transport's step buttons and the ←/→ keyboard shortcut).
 * - `advancePlayhead(t, dtSeconds, playback, fullScale)` moves `t` toward the present at
 *   constant velocity in `fullScale`'s warped `u` (always the *full-domain* scale, never the
 *   current window's — so playback speed is independent of zoom), scaled by `playback.speed`,
 *   clamped at the present. `usePlaybackLoop` drives it off `requestAnimationFrame`.
 * - `followWindow(window, t, scaleKind)` — follow-during-playback (README §4): pans (never
 *   resizes) the window once the playhead nears its present-side edge. Pure; the caller
 *   (Experience.tsx, next to the playback loop) decides *whether* to apply the result and owns
 *   disengage/re-engage on manual pan/zoom vs. the next play press.
 * - `useWindowTransition({ window, scaleKind, onWindowChange })` returns `animateWindowTo`,
 *   which eases a window change over `WINDOW_TRANSITION_MS` in warped space — used by every
 *   *discrete* window change `Timeline` originates (zoom buttons, fit-all, event framing, a
 *   minimap click). Wheel, pinch and drags call `onWindowChange` directly instead and so are
 *   immediate.
 * - `formatGeoTime(t)` renders a `GeoTime` for humans (`"4.57 Ga"`, `"66 Ma"`, `"11.7 ka"`,
 *   `"250 years ago"`, `"present"`); `formatTimeRange(window)` does the same for a whole window
 *   (`"12 ka – present"`, `"252–201 Ma"`) — both exported for other packages that need to print
 *   a time without the rest of the timeline UI.
 * - `ERA_BANDS` — the eon/era boundaries (ICS v2024/12) behind the minimap's orientation bands.
 * - `timelineKeyIntent(event)` maps a keydown to a `TimelineKeyIntent` (or `null`), ignoring
 *   text-input targets — the pure half of `Timeline`'s keyboard handling.
 *
 * ## `<Timeline>` — props contract
 *
 * See the doc comment on `TimelineProps` in Timeline.tsx.
 */

export { ERA_BANDS, type EraBand } from './eras'
export { formatGeoTime, formatTimeRange } from './format'
export { FOLLOW_TARGET_U, FOLLOW_TRIGGER_U, followWindow } from './follow'
export { timelineKeyIntent, type TimelineKeyEvent, type TimelineKeyIntent } from './keyboard'
export { minImportanceForSpan, nearestNeighbourEvent, visibleEvents, type EventStepDirection } from './lod'
export { minimapBracket, MINIMAP_FULL_DOMAIN, MIN_BRACKET_PX, type BracketLayout } from './minimapLayout'
export { advancePlayhead, usePlaybackLoop } from './playback'
export {
  blendScales,
  createLinearScale,
  createSymlogScale,
  SYMLOG_C,
  type TimeWindow,
} from './scale'
export { generateTicks, type AxisTick } from './ticks'
export { Timeline, type TimelineProps } from './Timeline'
export { useAnimatedScale } from './useAnimatedScale'
export { usePrefersReducedMotion } from './usePrefersReducedMotion'
export { interpolateWindow, useWindowTransition, WINDOW_TRANSITION_MS } from './windowTransition'
export { EVENT_FRAME_PADDING_FACTOR, frameEventWindow, MIN_SPAN_YEARS, panWindow, zoomWindow } from './zoom'
