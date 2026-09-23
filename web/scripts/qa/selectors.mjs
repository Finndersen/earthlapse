/**
 * Shared, stable-ish selectors for the app's three WebGL canvases. `data-testid` covers two of
 * them already; the scene canvas (`scene/SceneCanvasView.tsx`) has none (only its non-WebGL
 * fallback, `SceneFallbackView`, does — see that file's `data-testid="scene-base"`/`"scene-
 * overlay"`), and that file is outside this harness's edit scope (`web/scripts/**` and
 * `web/src/store/devHook.ts` only). `SCENE_CANVAS_SELECTOR` below is an exclusion selector as a
 * workaround: "the canvas that is neither the globe's nor the ancestor portrait's". It is real
 * project debt — a `data-testid="scene-canvas"` on `SceneCanvasView`'s `<Canvas>` would make this
 * one line instead of an exclusion — flagged here rather than silently worked around forever.
 */

export const GLOBE_CANVAS_SELECTOR = 'div[data-map-mode] canvas'
export const ANCESTOR_CANVAS_SELECTOR = '[data-testid="ancestor-portrait"] canvas'
export const SCENE_CANVAS_SELECTOR = `canvas:not(${GLOBE_CANVAS_SELECTOR}):not(${ANCESTOR_CANVAS_SELECTOR})`

/** The `<Timeline>` control's own root — scrub track, ruler, section bands and the transport row
 *  (back/play/forward, breadcrumb, speed/mode/scale/sound, rate readout): the "bottom chrome",
 *  everything below the scene caption, which is a separate `ShellLayout` slot. */
export const BOTTOM_CHROME_SELECTOR = '[data-testid="timeline-root"]'

/** The Dinosaurs/Humans "jump to an era" shortcut group (`timeline/components/EraShortcuts.tsx`).
 *  Rendered into a `ShellLayout` slot, outside `BOTTOM_CHROME_SELECTOR`'s subtree. */
export const ERA_SHORTCUTS_SELECTOR = '[data-testid="era-shortcuts"]'

/** The breadcrumb's own `<nav>` root (`SectionBreadcrumb.tsx`) — the whole trail, not just the
 *  current crumb (`BREADCRUMB_CURRENT_SELECTOR`, below). */
export const BREADCRUMB_SELECTOR = 'nav[aria-label="Timeline section"]'

/** The current crumb in the era-section breadcrumb (`SectionBreadcrumb.tsx`) — its text is the
 *  selected section's own geological `label` ("Mesozoic", "Holocene", "Earth"), never a
 *  shortcut's plain-language nickname, so a shot can prove a shortcut click actually narrowed
 *  the timeline to the real section it aliases. Scoped to the breadcrumb `<nav>` specifically:
 *  an era-shortcut button also carries `aria-current="location"` while active, and an
 *  unqualified `[aria-current="location"]` would match both and make a single-element read
 *  (`page.textContent`) throw in Playwright's strict mode. */
export const BREADCRUMB_CURRENT_SELECTOR = 'nav[aria-label="Timeline section"] [aria-current="location"]'

/** The section-band strip's own `<nav>` (`SectionBands.tsx`) — its `aria-label` is "Sections of
 *  <parent label>", so reading it proves which section's *children* are actually on screen after
 *  a shortcut click, the same thing a viewer would see by eye. */
export const SECTION_BANDS_SELECTOR = '[data-section-bands]'

/** The expanded globe's two invisible fit-target rectangles (`Globe.tsx`/`Globe.module.css`'s
 *  `.orbFitFrameSphere`/`.orbFitFrameMap`) — `GlobeCameraControls` fits the *default* sphere/map
 *  view against these, not the canvas's own now-full-viewport box (`Globe.module.css`'s
 *  `.orbExpanded` doc comment). `visibility: hidden`, so `measure.mjs`'s `drawnBounds` (which
 *  waits for Playwright's "visible" actionability state) can't target them directly — a shot
 *  reads their real rect with a plain `page.evaluate(() => el.getBoundingClientRect())` (that
 *  works regardless of CSS visibility) and feeds it to `drawnBoundsInClip` instead, to scope a
 *  sphere-size measurement to a region clear of the surrounding chrome (the "Globe/Map" toggle,
 *  legend, close button and zoom controls) that the now-full-viewport `GLOBE_CANVAS_SELECTOR`
 *  box would otherwise also sweep in. */
export const GLOBE_SPHERE_FIT_FRAME_SELECTOR = '[data-testid="globe-sphere-fit-frame"]'
export const GLOBE_MAP_FIT_FRAME_SELECTOR = '[data-testid="globe-map-fit-frame"]'

/** The expanded globe's own caption slot (`ShellLayout.tsx`'s `.expandedGlobeCaption`) — always
 *  mounted, since it is `useChromeGap`'s own measurement anchor, and never populated with text. */
export const EXPANDED_GLOBE_CAPTION_SELECTOR = '[data-testid="expanded-globe-caption"]'
/** The minimised orb's former caption label. The globe draws no caption in either state, so this
 *  matches nothing — kept as the guard that asserts it stays that way. */
export const MINIMISED_GLOBE_LABEL_SELECTOR = '[data-testid="minimised-globe-label"]'

/** A single-scene timeline checkpoint marker (`ScrubTrack.tsx`'s `data-checkpoint-pip`) — not a
 *  cluster marker (`data-checkpoint-cluster`), which has no hover thumbnail of its own. */
export const CHECKPOINT_PIP_SELECTOR = '[data-checkpoint-pip]'

/** The checkpoint pip's own hover preview card (`ScrubTrack.tsx`'s `.pipPreview`, shown on hover/
 *  focus) — a substring class match since `ScrubTrack.tsx`/`.module.css` are outside this QA
 *  harness's edit scope and so have no `data-testid` of their own to select by; CSS Modules hash
 *  the class name but keep the source name as a substring (e.g. `ScrubTrack_pipPreview__xyz`). */
export const PIP_PREVIEW_SELECTOR = '[class*="pipPreview"]'

/** The expanded globe's own "Globe / Map" toggle (`Globe.tsx`'s `ViewModeToggle`). */
export const VIEW_MODE_TOGGLE_SELECTOR = '[data-testid="globe-view-mode-group"]'

/** The expanded globe's zoom rocker (`Globe.tsx`'s `ZoomControls`). Selected through its own
 *  "Zoom in" button rather than a testid, since the group element carries no attribute of its
 *  own; `:has()` keeps the measured box the whole pill, not one of its two buttons. */
export const ZOOM_CONTROLS_SELECTOR = 'div:has(> button[aria-label="Zoom in"])'

/** The first-visit tour (`@/onboarding`): its whole layer, the callout card, the highlight ring
 *  around the step's target, and the two controls a shot drives. A fresh browser context has no
 *  `localStorage`, so the tour opens on load and `run.mjs` dismisses it before any shot runs —
 *  `ONBOARDING_TOUR_SELECTOR` is what that dismissal waits on. */
export const ONBOARDING_TOUR_SELECTOR = '[data-testid="onboarding-tour"]'
export const ONBOARDING_CARD_SELECTOR = '[data-testid="onboarding-card"]'
export const ONBOARDING_SPOTLIGHT_SELECTOR = '[data-testid="onboarding-spotlight"]'
export const ONBOARDING_SKIP_SELECTOR = '[data-testid="onboarding-skip"]'
export const ONBOARDING_NEXT_SELECTOR = '[data-testid="onboarding-next"]'

/** The transport's own play/pause button (`Transport.tsx`'s `TransportCore`), inside
 *  `TIMELINE_CONTROLS_CORE_SELECTOR`. Selected by accessible name — it carries no testid of its
 *  own, and the name is "Pause" while playing — the same approach `ZOOM_CONTROLS_SELECTOR` above
 *  takes, and the same selector the tour's own play step anchors to (`onboarding/steps.ts`). */
export const PLAY_BUTTON_SELECTOR = '[data-testid="timeline-controls-core"] button:is([aria-label="Play"], [aria-label="Pause"])'

/** The minimised globe orb's expand affordance (`Globe.tsx`'s `.expandButton`) — the circle inset
 *  inside the orb's box, so its geometry is also the orb's own drawn silhouette. */
export const GLOBE_EXPAND_SELECTOR = '[data-testid="globe-expand"]'

/** The left column's readouts row (`ShellLayout.tsx`'s `.readouts`) and, below it, the event feed
 *  slot (`.feed`) — the grid's `auto`/`minmax(0, 1fr)` row pair `ShellLayout.module.css`'s `.feed`
 *  doc comment describes: hiding a HUD readout (`@/layers/hudVisibility.ts`) shrinks the `auto`
 *  readouts row, and the feed's own `1fr` track claims whatever that frees. Both boxes are
 *  measured with a plain `boxOf` (layout, not paint) — `.feed` itself is a transparent, always-
 *  present sizing box (its own doc comment) that draws nothing when the feed has no cards, so a
 *  drawn-pixel measurement would read `0` regardless of the row's real reserved height. */
export const SHELL_READOUTS_SELECTOR = '[data-testid="shell-readouts"]'
export const SHELL_FEED_SELECTOR = '[data-testid="shell-feed"]'

/** One `<li>` per visible card inside `<EventFeed>` (`EventFeed.tsx`'s `data-testid={\`event-feed-
 *  item-${event.id}\`}`) — a plain attribute-prefix selector rather than a per-event id, since
 *  what a QA shot cares about is how many cards are showing, not which events they are. */
export const EVENT_FEED_ITEM_SELECTOR = '[data-testid^="event-feed-item-"]'

/** The boxes sharing the bottom chrome's horizontal gutter (`Timeline.module.css`'s
 *  `--timeline-gutter`): the scrub track/ruler/band strip's own inset box (`SectionEdgeNav.tsx`'s
 *  `.stack`), the breadcrumb's row (`.controlsSections`), the transport (`.controlsCore`) and the
 *  mode/scale/sound row (`.controlsSecondary`). */
export const TIMELINE_TRACK_STACK_SELECTOR = '[data-testid="timeline-track-stack"]'
export const TIMELINE_CONTROLS_SECTIONS_SELECTOR = '[data-testid="timeline-controls-sections"]'
export const TIMELINE_CONTROLS_CORE_SELECTOR = '[data-testid="timeline-controls-core"]'
export const TIMELINE_CONTROLS_SECONDARY_SELECTOR = '[data-testid="timeline-controls-secondary"]'

/** The globe's raster overlay picker's native `<select>` (`OverlaySelect.tsx`). */
export const OVERLAY_SELECT_SELECTOR = '[data-testid="overlay-select"]'
