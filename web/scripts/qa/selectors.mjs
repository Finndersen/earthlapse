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
 *  (back/play/forward, breadcrumb, speed/mode/scale/sound, rate readout) — the "bottom chrome"
 *  the brief means (CLAUDE.md's condensing task): everything below the scene caption, which is a
 *  separate `ShellLayout` slot and not part of this stack. Carries this `data-testid` itself
 *  (`Timeline.tsx`), so no exclusion-selector workaround is needed the way the scene canvas above
 *  requires. */
export const BOTTOM_CHROME_SELECTOR = '[data-testid="timeline-root"]'

/** The Earth/Dinosaurs/Humans "jump to an era" shortcut group. Originally lived beside the shell
 *  title, outside the bottom chrome; a later pass the same day (`timeline/components/
 *  EraShortcuts.tsx`) moved it into `<Timeline>`'s own controls row, so it is now INSIDE
 *  `BOTTOM_CHROME_SELECTOR`'s own subtree — folded into the room freed by deleting the
 *  breadcrumb's "‹ Up"/"⌂ Earth" buttons and moving its "‹"/"›" buttons onto the track edges
 *  (`SectionEdgeNav`), rather than adding a row, so it still costs the chrome's measured height
 *  nothing (see `bottom-chrome-height`/`era-shortcuts-group` in shots.mjs for the actual numbers). */
export const ERA_SHORTCUTS_SELECTOR = '[data-testid="era-shortcuts"]'

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
