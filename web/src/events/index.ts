/**
 * web/src/events — the event feed (docs/DESIGN.md § Event feed; the approved roadmap's
 * "non-intrusive playback pop-up cards" / "event card (description + citation)"). Surfaces
 * events as the playhead reaches them, instead of requiring a hover over the timeline.
 *
 * Prop-driven and pure in `t`, matching every other package here: nothing in `select.ts`
 * reads a store, a ref, or wall-clock time. `<EventFeed>` layers presentational chrome on top
 * (reduced motion, a narrow-viewport compact mode, a throttled aria-live announcement) the
 * same way `SceneView` and `AncestorPortrait` do.
 *
 * - `selectFeedEvents(events, t, scale, trackWidthPx, options?)` — which events are "behind"
 *   `t` (already reached, chronologically, regardless of scrub direction) within
 *   `options.lookbackPx` of `t`'s own position on `scale`, measured in *displayed* pixels so
 *   the window adapts to how dense the local stretch of the axis reads. Freshest first, capped
 *   at `options.maxVisible`; `options.excludedEventIds` skips ids outright (see
 *   `sceneCaptionedEventIds`). `feedCardOpacity`/`feedCardOffsetPx` turn a card's
 *   `distanceFraction` into presentation.
 * - `placementT(event)` / `formatEventDate(event)` — the frontend twin of ADR-022's
 *   `Event.placement_t`, and the date line a card prints from it (`formatGeoTime` for a
 *   `'moment'`, `formatTimeRange` for a `'period'`).
 * - `sceneCaptionedEventIds(scenes, t)` — the ids the currently-captioned scene already names
 *   (`Scene.events`), reusing `@/scene`'s own `sceneAt`/`dominantScene` rather than re-deriving
 *   "the current scene" a second way.
 * - `EVENT_TAG_PALETTE` / `primaryTag(event)` — the one place an `EventTag` maps to a colour
 *   (ADR-022 defers timeline colouring by tag to a later task; that later work should import
 *   this rather than invent its own).
 * - `useIsCompactViewport()` — mirrors `ShellLayout`'s own phone breakpoint, for the "compact
 *   single-card strip" the brief calls for at narrow widths.
 */

export { EventFeed, type EventFeedProps } from './components/EventFeed'
export { formatEventDate, placementT } from './placement'
export { sceneCaptionedEventIds } from './sceneLink'
export {
  DEFAULT_LOOKBACK_PX,
  DEFAULT_MAX_AGE_RATIO,
  DEFAULT_MAX_VISIBLE,
  RECENCY_FLOOR_YEARS,
  feedCardOffsetPx,
  feedCardOpacity,
  MAX_CARD_OFFSET_PX,
  selectFeedEvents,
  type FeedEntry,
  type FeedSelection,
  type SelectFeedEventsOptions,
} from './select'
export { EVENT_TAG_PALETTE, primaryTag, type EventTagStyle } from './tagPalette'
export { useIsCompactViewport } from './useIsCompactViewport'
