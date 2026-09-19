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
 * - `selectFeedEvents(events, t, options?)` — which events are "behind" `t` (already reached,
 *   chronologically, regardless of scrub direction) and no more than `options.maxAgeRatio`
 *   times older than `t` itself. Freshest first, capped at `options.maxVisible`. An event the
 *   currently-captioned scene's own caption already names (`Scene.events`, ADR-022) is **not**
 *   excluded: `kpg-arrival` and `kpg-darkness` both link `k-pg-impact`, so excluding it would
 *   hide the event from the feed for the whole span either scene is on screen, well past when
 *   the impact itself should have surfaced. Every event reached by the playhead always shows.
 * - `feedCardEmphases(visible)` / `feedCardOpacity` (`presentation.ts`) — pure presentation: the
 *   freshest card's "just reached" emphasis easing away across a band of its age window, and
 *   each card's fade as it recedes.
 * - `placementT(event)` / `formatEventDate(event)` — the frontend twin of ADR-022's
 *   `Event.placement_t`, and the date line a card prints from it (`formatGeoTime` for a
 *   `'moment'`, `formatTimeRange` for a `'period'`).
 * - `EVENT_TAG_PALETTE` / `primaryTag(event)` — the one place an `EventTag` maps to a colour.
 *   `<EventFeed>`'s own card reads it for its primary-tag label and accent; `EventDetailPanel`
 *   for every tag a card carries; `EventTagLegend` for the compact six-dot key. Any future
 *   timeline colouring by tag (ADR-022, still deferred) should reuse it too rather than invent a
 *   second legend.
 * - `EventDetailPanel` — the full-detail popout a feed card opens on click/tap/Enter (label,
 *   date/range, every tag, description, citation, "Show on timeline"), built on `@/shell`'s
 *   shared `Panel` rather than a bespoke dialog — the one deliberate exception to this package's
 *   usual self-containment (everything else here stays prop-driven with no store or
 *   cross-package reads), per the explicit "one shared panel primitive, not three bespoke focus
 *   traps" requirement. `shell` does not import back from `events` — it used to, for
 *   `EventTagLegend` (see the next bullet), which meant the two packages imported each other and
 *   only worked because `Panel` is used at render time, not import time. This remains a
 *   one-directional edge.
 * - `EventTagLegend` — the compact six-dot "what the colours mean" key. Pure presentation, no
 *   `@/shell` dependency of its own: the caller that already composes both packages
 *   (`app/Experience.tsx`, and `/credits`' own page) passes it into `@/shell`'s `CreditsList` as
 *   a plain `ReactNode` prop, so `CreditsList` mounts it inside the existing About & credits
 *   panel without `shell` importing this package to do it.
 * - `useIsCompactViewport()` — mirrors `ShellLayout`'s own phone breakpoint, for the "compact
 *   single-card strip" the brief calls for at narrow widths.
 */

export { EventDetailPanel, type EventDetailPanelProps } from './components/EventDetailPanel'
export { EventFeed, type EventFeedProps } from './components/EventFeed'
export { EventTagLegend } from './components/EventTagLegend'
export { formatEventDate, placementT } from './placement'
export {
  FEED_CARD_GAP_PX,
  FEED_CARD_HEIGHT_PX,
  FRESH_EMPHASIS_BAND,
  MAX_FRESH_INSET_PX,
  feedCardEmphases,
  feedCardInsetPx,
  feedCardOpacity,
} from './presentation'
export {
  DEFAULT_MAX_AGE_RATIO,
  DEFAULT_MAX_VISIBLE,
  RECENCY_FLOOR_YEARS,
  selectFeedEvents,
  type FeedEntry,
  type FeedSelection,
  type SelectFeedEventsOptions,
} from './select'
export { EVENT_TAG_PALETTE, primaryTag, type EventTagStyle } from './tagPalette'
export { useIsCompactViewport } from './useIsCompactViewport'
