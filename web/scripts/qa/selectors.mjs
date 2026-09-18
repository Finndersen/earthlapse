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

/** The Earth/Dinosaurs/Humans "jump to an era" shortcut group (`ShellLayout.tsx`, user ask
 *  2026-09-18) — lives beside the title, deliberately outside `BOTTOM_CHROME_SELECTOR`'s own
 *  subtree, so it costs the timeline's own (recently condensed) bottom chrome no height at all. */
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
