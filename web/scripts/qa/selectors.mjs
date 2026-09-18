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
