/**
 * The shot list — data, not code. Adding a check means adding one object here; `run.mjs` never
 * needs to change. See `README.md` for the full `Shot` contract; the gist:
 *
 * - `t` and `state` are declarative: the runner applies them through `window.__earthtime` before
 *   every measurement, in a fixed, safe order (pause -> `t` -> globe expand -> globe view mode ->
 *   layer toggles) so a shot only has to name the end state it wants.
 * - `actions`, when the declarative `state` isn't enough (the mid-transition shot below), is an
 *   async function run after `state` is applied and before the runner's own `ready()`/settle wait.
 * - `measure` returns whatever numeric facts the shot cares about; `expect` asserts numeric
 *   ranges against dot-paths into that object.
 */

import { drawnBounds } from './measure.mjs'
import { waitForApproxUnfoldProgress } from './timeouts.mjs'
import { GLOBE_CANVAS_SELECTOR, SCENE_CANVAS_SELECTOR } from './selectors.mjs'

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

/**
 * @typedef {Object} ShotState
 * @property {boolean} [playing]
 * @property {boolean} [globeExpanded]
 * @property {'globe' | 'map'} [globeViewMode]
 * @property {Record<string, boolean>} [layerToggles]
 */

/**
 * @typedef {Object} Shot
 * @property {string} name - filesystem-safe, used for the screenshot filename
 * @property {string} description - one line: what this shot guards
 * @property {{width: number, height: number}} [viewport] - defaults to 1440x900
 * @property {'reduce' | 'no-preference'} [reducedMotion] - overrides the run's own --reduced-motion default
 * @property {number} [t] - years before present
 * @property {ShotState} [state]
 * @property {(ctx: { page: import('playwright').Page, hook: ReturnType<typeof import('./hook.mjs').makeHook> }) => Promise<void>} [actions]
 * @property {(ctx: { page: import('playwright').Page, hook: ReturnType<typeof import('./hook.mjs').makeHook> }) => Promise<Record<string, unknown>>} [measure]
 * @property {Record<string, [number, number]>} [expect] - dot-path into `measure`'s result -> [min, max]
 */

/** @type {Shot[]} */
export default [
  {
    name: 'present-day-default',
    description: 'Present day (t=0), default collapsed view — baseline for the whole shell layout.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
  },
  {
    name: 'early-earth-archean-shore',
    description: 'Deep-time scene (~3.45 Ga, "A Stromatolite Shore") — scene art and globe raster/regime rendering that far back.',
    viewport: DEFAULT_VIEWPORT,
    t: 3_450_000_000,
  },
  {
    name: 'globe-expanded-sphere',
    description: 'Expanded globe, sphere mode — guards against the CSS-box/drawn-pixel mix-up that shrank the sphere to ~226px.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page }) => ({ sphere: await drawnBounds(page, GLOBE_CANVAS_SELECTOR) }),
    expect: { 'sphere.width': [480, 560], 'sphere.height': [480, 560] },
  },
  {
    name: 'globe-expanded-map',
    description: 'Expanded globe, unrolled Equal Earth map mode — guards the map-mode fit-to-panel framing (ADR-033).',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    measure: async ({ page }) => ({ map: await drawnBounds(page, GLOBE_CANVAS_SELECTOR) }),
    expect: { 'map.width': [1000, 1150] },
  },
  {
    name: 'globe-transition-mid-unfold',
    description: 'Sphere->map toggle sampled ~halfway through the ~0.8s unfold tween — catches the folding/square-clip glitch.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    // Overrides the run's own reduced-motion default: `Globe.tsx`'s unfold tween is itself
    // skipped (an instant snap) under prefers-reduced-motion, which would leave nothing to
    // sample mid-transition.
    reducedMotion: 'no-preference',
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      await hook.setGlobeViewMode('map')
      await waitForApproxUnfoldProgress(page, 0.5)
    },
    measure: async ({ page }) => ({ globe: await drawnBounds(page, GLOBE_CANVAS_SELECTOR) }),
    expect: { 'globe.width': [50, 2000], 'globe.height': [50, 2000] },
  },
  {
    name: 'green-sahara-bright-plate',
    description: 'Green Sahara (~8000 yr) — bright-plate scene, checks vignette/legibility over a light image.',
    viewport: DEFAULT_VIEWPORT,
    t: 8000,
    measure: async ({ page }) => ({ scene: await drawnBounds(page, SCENE_CANVAS_SELECTOR) }),
    expect: { 'scene.fractionOfViewport': [0.5, 1] },
  },
  {
    name: 'human-civilisation-1500ce',
    description: 'Human civilisation layer on, globe expanded, ~1500 CE — arrival/settlement/density overlays on the expanded panel.',
    viewport: DEFAULT_VIEWPORT,
    t: 525,
    state: { globeExpanded: true, layerToggles: { 'human-civilisation': true } },
  },
  {
    name: 'viewport-1024x768',
    description: 'Common laptop viewport sanity check — default view.',
    viewport: { width: 1024, height: 768 },
    t: 0,
  },
  {
    name: 'viewport-390x844-phone-portrait',
    description: 'Phone portrait sanity check — default view, ancestor panel collapse behaviour.',
    viewport: { width: 390, height: 844 },
    t: 0,
  },
]
