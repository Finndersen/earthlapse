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

import { rafTicks } from './hook.mjs'
import { boxOf, drawnBounds, drawnBoundsInClip, hiddenBoxOf } from './measure.mjs'
import { waitForApproxUnfoldProgress, waitForFocusEaseSettle, waitForSceneCrossfadeSettle } from './timeouts.mjs'
import {
  BOTTOM_CHROME_SELECTOR,
  BREADCRUMB_CURRENT_SELECTOR,
  BREADCRUMB_SELECTOR,
  CHECKPOINT_PIP_SELECTOR,
  ERA_SHORTCUTS_SELECTOR,
  EVENT_FEED_ITEM_SELECTOR,
  GLOBE_CANVAS_SELECTOR,
  GLOBE_MAP_FIT_FRAME_SELECTOR,
  EXPANDED_GLOBE_CAPTION_SELECTOR,
  GLOBE_SPHERE_FIT_FRAME_SELECTOR,
  MINIMISED_GLOBE_LABEL_SELECTOR,
  PIP_PREVIEW_SELECTOR,
  SCENE_CANVAS_SELECTOR,
  SECTION_BANDS_SELECTOR,
  SHELL_FEED_SELECTOR,
  SHELL_READOUTS_SELECTOR,
  TIMELINE_CONTROLS_CORE_SELECTOR,
  TIMELINE_CONTROLS_SECONDARY_SELECTOR,
  TIMELINE_CONTROLS_SECTIONS_SELECTOR,
  TIMELINE_TRACK_STACK_SELECTOR,
  VIEW_MODE_TOGGLE_SELECTOR,
} from './selectors.mjs'

/** Whether two `{x, y, width, height}` CSS-pixel boxes (`measure.mjs`'s `PixelBox`) intersect —
 *  used to prove two pieces of HUD chrome genuinely don't overlap, not just "look" clear in a
 *  screenshot. Half-open on purpose (`<`/`>`, not `<=`/`>=`): two boxes exactly edge-to-edge, 0px
 *  apart, read as clear, matching how CSS layout itself treats adjacency. */
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Runs inside the page (`page.evaluate`, self-contained — no closures over `shots.mjs`'s own
 * module scope): the number of *distinct* direct-child pairs of `containerSelector`'s own element
 * whose drawn boxes overlap — 0 means every child is clear of every other. Two children sitting on
 * different wrapped flex lines never report an overlap here (their `y` ranges don't intersect),
 * so this is a genuine "did content collide" check, not a "did the row wrap" one — root-cause
 * regression coverage for the historical "mute/volume button overlaps the next/fast-forward
 * button" bug (`Timeline.module.css`'s `.controlsSecondary` doc comment).
 * @param {{ containerSelector: string }} args
 */
function countOverlappingChildPairs({ containerSelector }) {
  const container = document.querySelector(containerSelector)
  if (container === null) return 0
  const boxes = Array.from(container.children).map((el) => el.getBoundingClientRect())
  let overlaps = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) overlaps += 1
    }
  }
  return overlaps
}

/**
 * Runs inside the page (`page.evaluate`, self-contained): the number of distinct rows
 * `containerSelector`'s own direct children fall into, grouped by rounded `top` — 1 means every
 * child sits on one line (no wrap), 2+ means the flex row has wrapped. A generic "did this
 * flex-wrap row actually wrap" check, independent of `countOverlappingChildPairs`'s "did two
 * children collide" one: a wrapped row is fine as long as nothing overlaps, but the coordinator's
 * ask here is specifically that the row does *not* wrap at all at the widths this guards.
 * @param {{ containerSelector: string }} args
 */
function countDistinctRows({ containerSelector }) {
  const container = document.querySelector(containerSelector)
  if (container === null) return 0
  const tops = Array.from(container.children).map((el) => Math.round(el.getBoundingClientRect().top))
  return new Set(tops).size
}

/**
 * Runs inside the page (`page.evaluate`): whether the first `n` direct children of
 * `containerSelector`'s own element all share one row (rounded `top`). Used where a *trailing*
 * child is allowed to wrap onto its own line (`.controlsSecondary`'s `rateReadoutRow` — two
 * always-reserved, usually-empty slots, not a control a viewer would notice dropping) but the
 * children before it must not.
 * @param {{ containerSelector: string, n: number }} args
 */
function firstChildrenShareRow({ containerSelector, n }) {
  const container = document.querySelector(containerSelector)
  if (container === null) return false
  const tops = Array.from(container.children)
    .slice(0, n)
    .map((el) => Math.round(el.getBoundingClientRect().top))
  return new Set(tops).size === 1
}

/**
 * Runs inside the page (`page.evaluate`, self-contained): the rounded `{x, y}` of every direct
 * child of `containerSelector`'s own element, in DOM order — used to prove a fixed-width cluster
 * (`.controlsSecondary`'s sound/speed/mode/era-shortcuts/scale/rate-badge group) sits at the exact
 * same pixel positions regardless of the breadcrumb's own length in the sibling track, not merely
 * "looks about right" in one screenshot.
 * @param {{ containerSelector: string }} args
 */
function childPositions({ containerSelector }) {
  const container = document.querySelector(containerSelector)
  if (container === null) return []
  return Array.from(container.children).map((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })
}

/**
 * A thin horizontal strip through the expanded globe's own vertical centre, wide enough to prove
 * real horizontal growth but narrow (in height) enough to clear every piece of chrome that could
 * otherwise contaminate a `drawnBounds`-style scan of the now-full-viewport `<canvas>` — the top-
 * left "Globe/Map" toggle and legend, the top-right close button, and the right-centre zoom
 * controls (`GLOBE_SPHERE_FIT_FRAME_SELECTOR`'s own doc comment explains why `GLOBE_CANVAS_SELECTOR`
 * alone can no longer isolate the sphere from any of them). Deliberately a *width*-only proof: at
 * `DEFAULT_VIEWPORT`, the default sphere already fills nearly the whole real vertical gap between
 * the title and the timeline (by design — `Globe.module.css`'s `.orbFitFrameSphere` "fill the real
 * gap" formula) with only ~20px to spare, so there is no meaningful *vertical* chrome-free room
 * left to prove growth into even before zooming in further — but a circle that grows wider
 * necessarily grows taller by the same factor, so a width-only proof is not a weaker one. Margins
 * were picked by eye against this file's own screenshots, not derived from CSS — a chrome change
 * that moves into this band will need this constant nudged.
 */
const GLOBE_CHROME_FREE_STRIP = { x: 20, y: 360, width: 1320, height: 100 }

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

/**
 * Screenshots the first element matching `selector`, clipped to its own drawn box — the same box
 * `measure.mjs`'s `drawnBounds` locates, but returned as a raw PNG buffer rather than scanned for
 * a bounding rect, since the two arc shots below need to diff two whole frames against each
 * other, not find where one frame differs from its own sampled-corner background.
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function screenshotClip(page, selector) {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`screenshotClip: "${selector}" has no box (display:none?)`)
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  const png = await page.screenshot({ clip })
  return { png, area: clip.width * clip.height }
}

/**
 * Runs inside the page (`page.evaluate`, must be self-contained — no closures over this module's
 * scope): counts pixels that differ between two same-size screenshots by more than `threshold`
 * (summed per-channel). Mirrors `measure.mjs`'s own `scanDrawnPixels`, but diffs two real frames
 * against each other rather than one frame against its sampled-corner background — an arrival
 * arc is drawn *over* an already-opaque globe (sphere or map), so "differs from a corner sample"
 * would just measure the globe's own silhouette, not the arc.
 * @param {{ dataUrlA: string, dataUrlB: string, threshold: number }} args
 * @returns {Promise<number>}
 */
async function countDiffPixels({ dataUrlA, dataUrlB, threshold }) {
  const decode = (src) =>
    new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('countDiffPixels: failed to decode a probe screenshot'))
      el.src = src
    })
  const [imageA, imageB] = await Promise.all([decode(dataUrlA), decode(dataUrlB)])
  const canvas = document.createElement('canvas')
  canvas.width = imageA.naturalWidth
  canvas.height = imageA.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('countDiffPixels: 2D canvas context unavailable')
  ctx.drawImage(imageA, 0, 0)
  const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(imageB, 0, 0)
  const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3])
    if (diff > threshold) count += 1
  }
  return count
}

/**
 * How many of `selector`'s own drawn pixels differ (see `countDiffPixels`) between two
 * screenshots taken back to back, with `between` run in between them to change what's on screen.
 * Returns the raw count and the count as a fraction of the clip's own area, so a shot's `expect`
 * can assert either an absolute floor or a proportion.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {() => Promise<void>} between
 * @param {{ threshold?: number }} [options]
 */
async function drawnPixelDiff(page, selector, between, { threshold = 40 } = {}) {
  const { png: pngA, area } = await screenshotClip(page, selector)
  await between()
  const { png: pngB } = await screenshotClip(page, selector)
  const dataUrlA = `data:image/png;base64,${pngA.toString('base64')}`
  const dataUrlB = `data:image/png;base64,${pngB.toString('base64')}`
  const diffPixels = await page.evaluate(countDiffPixels, { dataUrlA, dataUrlB, threshold })
  return { diffPixels, diffFraction: area > 0 ? diffPixels / area : 0 }
}

/**
 * The union bounding box of every `<polyline>` inside `containerSelector`'s first match, in page
 * (CSS pixel) coordinates — `{width: 0, height: 0}` when there are none. Exists because
 * `drawnBounds` (pixel-diffing against the target's own sampled-corner background) is the wrong
 * tool for the sparkline/`LayerChart` trace specifically: both are drawn directly over a busy
 * photographic scene image with no opaque backing panel, so its own texture alone can differ from
 * a corner sample by more than `drawnBounds`' threshold — measured empirically at 173px (the
 * sparkline's own full CSS width) over a *blank* SVG containing only a 1px-wide playhead line,
 * i.e. pure background noise, not a drawn trace. A `<polyline>`'s own `getBoundingClientRect()`
 * is exact SVG geometry, immune to whatever photo sits behind it, and *is* "the drawn trace" in
 * the most literal sense available here — stronger, not weaker, than screenshot pixel-diffing.
 * @param {import('playwright').Page} page
 * @param {string} containerSelector
 * @returns {Promise<{x: number, y: number, width: number, height: number}>}
 */
async function polylineTraceBounds(page, containerSelector) {
  const boxes = await page.evaluate((sel) => {
    const container = document.querySelector(sel)
    if (!container) return []
    return Array.from(container.querySelectorAll('polyline')).map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
  }, containerSelector)
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const minX = Math.min(...boxes.map((b) => b.x))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Runs inside the page (`page.evaluate`, must be self-contained): decodes a screenshot and
 * returns the centroid (in the screenshot's own local pixel coordinates) of every pixel that
 * looks like the scene-location marker (`HumanCivilisation.tsx`'s `SCENE_RGB`,
 * `humanStyle.ts`'s `SCENE_LOCATION_COLOR = '#fdf6e8'`) — a warm off-white distinguishable from
 * the globe's own pure-white highlights (clouds, ice: `r === g === b`) by a small but
 * consistent red-over-blue skew. `count === 0` means no matching pixel was found at all.
 * @param {{ dataUrl: string }} args
 * @returns {Promise<{ x: number, y: number, count: number }>}
 */
async function scanForSceneMarkerColor({ dataUrl }) {
  const image = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('scanForSceneMarkerColor: failed to decode the probe screenshot'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('scanForSceneMarkerColor: 2D canvas context unavailable')
  ctx.drawImage(image, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  let sumX = 0
  let sumY = 0
  let count = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      const redOverBlue = r - b
      const redOverGreen = r - g
      if (a > 200 && r > 220 && g > 205 && redOverBlue > 6 && redOverBlue < 50 && redOverGreen >= 0 && redOverGreen < 30) {
        sumX += x
        sumY += y
        count += 1
      }
    }
  }
  return count === 0 ? { x: 0, y: 0, count: 0 } : { x: sumX / count, y: sumY / count, count }
}

/**
 * The scene-location marker's own screen centroid (page-absolute CSS px), found by colour
 * (`scanForSceneMarkerColor`) inside `clip` — `null` when nothing matched. Used instead of
 * `drawnPixelDiff`'s "toggle something off and diff" approach because the one thing that would
 * need toggling here, the "Human civilisation" legend row, only exists in the DOM while the
 * globe is *expanded* (`Legend.tsx` renders nothing minimised) — and expanding, even briefly,
 * resets the camera's own azimuth to its default framing (`Globe.tsx`'s `GlobeCameraControls`,
 * "a plain expand/collapse... reframes" doc comment), which would destroy exactly the camera
 * state ADR-034's centring is being measured against. Colour-matching the marker directly avoids
 * ever touching `expanded` during a measurement.
 * @param {import('playwright').Page} page
 * @param {{x: number, y: number, width: number, height: number}} clip
 * @returns {Promise<{ x: number, y: number, count: number } | null>}
 */
async function sceneMarkerCentroid(page, clip) {
  const roundedClip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) }
  const png = await page.screenshot({ clip: roundedClip })
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const local = await page.evaluate(scanForSceneMarkerColor, { dataUrl })
  if (local.count === 0) return null
  return { x: roundedClip.x + local.x, y: roundedClip.y + local.y, count: local.count }
}

/**
 * How far off-centre (degrees) the scene-location marker currently sits, horizontally, on the
 * *minimised* orb — the one measurement ADR-034's centring claim and this file's own
 * `useGlobeAutoRotation.ts` fix are actually about. Converts the measured pixel offset from the
 * drawn sphere's own centre (`drawnBounds` on `GLOBE_CANVAS_SELECTOR` — the sphere's circular
 * silhouette, not the canvas element's CSS box) to degrees via the standard "point on a sphere
 * viewed from outside" relation `screenOffsetPx ≈ apparentRadiusPx * sin(angleFromCentre)`: exact
 * for an orthographic projection and a close enough approximation this near the sphere's own
 * centre under this app's 40° perspective FOV. Positive means the marker sits to the right of
 * centre. Returns `null` (rather than throwing) when no marker pixel was found at all, so a shot
 * can assert on that directly instead of getting a misleading `0`.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ offsetDeg: number, markerPixelCount: number } | null>}
 */
async function globeOrbMarkerOffsetDeg(page) {
  const sphere = await drawnBounds(page, GLOBE_CANVAS_SELECTOR)
  if (sphere.width === 0) throw new Error('globeOrbMarkerOffsetDeg: the minimised orb drew nothing')
  const centreX = sphere.x + sphere.width / 2
  const apparentRadiusPx = sphere.width / 2
  const marker = await sceneMarkerCentroid(page, sphere)
  if (marker === null) return null
  const sinAngle = Math.max(-1, Math.min(1, (marker.x - centreX) / apparentRadiusPx))
  return { offsetDeg: (Math.asin(sinAngle) * 180) / Math.PI, markerPixelCount: marker.count }
}

/**
 * Drags the minimised orb (real `page.mouse` events, so `OrbitControls` sees a genuine drag, not
 * a click — `orbGesture.ts`'s `ORB_CLICK_DRAG_THRESHOLD_PX` is 4px, far below this) far enough to
 * leave the camera's azimuth well away from its default 0 — the precondition for the "moves but
 * doesn't go all the way" report (docs/GLOBE.md's ADR-034 section): a viewer who has ever dragged
 * the orb before a scene's location becomes the focus target.
 * @param {import('playwright').Page} page
 */
async function dragGlobeOrb(page) {
  const box = await page.locator(GLOBE_CANVAS_SELECTOR).first().boundingBox()
  if (box === null) throw new Error('dragGlobeOrb: globe canvas has no box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + Math.min(90, box.width * 0.5), cy, { steps: 12 })
  await page.mouse.up()
}

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
    name: 'expanded-globe-caption-removed',
    description:
      'User ask, 2026-09-18: "the extra globe labels when fullsreen like \'Geography unknown\', \'Snowball Earth · ' +
      'extent contested\' etc can be reoved". `t: 3.45 Ga` is squarely inside the "geography unknown — artistic" ' +
      'stylised-regime span (docs/GLOBE.md §1, 1.0-~4.4 Ga) — a real `t` that produced a caption before this ' +
      'change, not an assumed one (this file\'s own `early-earth-archean-shore` shot already uses it for the same ' +
      'deep-time reason). `EXPANDED_GLOBE_CAPTION_SELECTOR` must draw no text while expanded even here, and the ' +
      'minimised orb\'s own label (unaffected, collapsed only) must still show the real caption — proving the ' +
      "removal is scoped to *expanded* only, per the user's own \"when fullscreen\" wording.",
    viewport: DEFAULT_VIEWPORT,
    t: 3_450_000_000,
    measure: async ({ page, hook }) => {
      await hook.setGlobeExpanded(true)
      await hook.ready()
      await rafTicks(page, 2)
      const expandedText = (await page.locator(EXPANDED_GLOBE_CAPTION_SELECTOR).innerText()).trim()
      await hook.setGlobeExpanded(false)
      await hook.ready()
      await rafTicks(page, 2)
      const orbLabelText = (await page.locator(MINIMISED_GLOBE_LABEL_SELECTOR).innerText()).trim()
      return { expandedCaptionLength: expandedText.length, hasOrbLabelText: orbLabelText.length > 0 ? 1 : 0 }
    },
    expect: { expandedCaptionLength: [0, 0], hasOrbLabelText: [1, 1] },
  },
  {
    name: 'globe-expanded-sphere',
    description:
      'Expanded globe, sphere mode, measured at its own real DEFAULT diameter (drawn pixels, not a CSS box) — ' +
      "clipped to the real fit-frame rectangle (`GLOBE_SPHERE_FIT_FRAME_SELECTOR`'s own doc comment explains why " +
      '`GLOBE_CANVAS_SELECTOR` alone no longer isolates the sphere from the surrounding chrome) rather than ' +
      'measured at zoom-interaction time, so this is a zero-interaction "does it open at the right size" check. ' +
      "`useChromeGap` fits this panel to the shell's actual live title-to-timeline gap, so anything that changes " +
      "the title's own height legitimately moves this band — currently ~555px, with the era shortcuts living in " +
      'the timeline controls row rather than the title.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page }) => ({ sphere: await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR)) }),
    expect: { 'sphere.width': [535, 575], 'sphere.height': [535, 575] },
  },
  {
    name: 'globe-expanded-map',
    description:
      'Expanded globe, unrolled Equal Earth map mode, measured at its own real DEFAULT size (drawn pixels) — ' +
      "guards the map-mode fit-to-panel framing (ADR-033) the same way `globe-expanded-sphere` guards the sphere's " +
      "(same clip-to-real-fit-frame reasoning, against `GLOBE_MAP_FIT_FRAME_SELECTOR` — see that shot's own " +
      'description for why `GLOBE_CANVAS_SELECTOR` alone can no longer isolate the map from the surrounding ' +
      "chrome). Also checks that the default, fully-zoomed-out map cursor is *not* `grab`: `camera.ts`'s " +
      "`mapHasPanRoom` is false here (the fit distance's own margin already shows slightly more than the whole " +
      'map, so there is genuinely nowhere to pan to yet). Same title-height dependency as ' +
      "`globe-expanded-sphere`'s own.",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    measure: async ({ page }) => {
      const cursor = await page.locator(GLOBE_CANVAS_SELECTOR).first().evaluate((el) => getComputedStyle(el).cursor)
      const map = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_MAP_FIT_FRAME_SELECTOR))
      return { map, cursorIsNotGrab: cursor !== 'grab' ? 1 : 0 }
    },
    expect: { 'map.width': [1115, 1155], cursorIsNotGrab: [1, 1] },
  },
  {
    name: 'globe-sphere-zoom-past-fit',
    description:
      'BUG (user report, 2026-09-18: "currently when zooming in on the globe, it\'s constrained by a square ' +
      'bounding window which cuts it off") — pressing "Zoom in" (`ZoomControls`) several times must keep growing ' +
      'the drawn sphere well past `globe-expanded-sphere`\'s own ~592px default; the old bug capped it there ' +
      'exactly regardless of zoom, since the `<canvas>` itself *was* that square box. Measured over ' +
      '`GLOBE_CHROME_FREE_STRIP`, not the real fit frame (which the sphere legitimately grows past here) or the raw ' +
      'canvas (which would sweep in the surrounding chrome — see that constant\'s own doc comment); width-only, ' +
      "per that constant's own reasoning.",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      const zoomIn = page.getByRole('button', { name: 'Zoom in' })
      for (let i = 0; i < 4; i += 1) {
        await zoomIn.click()
        await rafTicks(page, 2)
      }
      await hook.ready()
    },
    measure: async ({ page }) => ({ sphere: await drawnBoundsInClip(page, GLOBE_CHROME_FREE_STRIP) }),
    // Comfortably above `globe-expanded-sphere`'s own [555, 595] default band — the old bug would
    // have failed this by capping at ~592px regardless of how many times "Zoom in" was pressed.
    // Capped by `GLOBE_CHROME_FREE_STRIP`'s own width (1320), not the sphere itself, past that point.
    expect: { 'sphere.width': [750, 1320] },
  },
  {
    name: 'globe-zoom-button-changes-drawn-size',
    description:
      'Requirement 4 (user ask, 2026-09-18: "add zoom in/out magnifying icons/buttons to the fullscreen map/globe ' +
      'view") — proves a single press of "Zoom in" actually changes the *drawn* globe content, not just some CSS ' +
      "box, matching CLAUDE.md's \"assert on drawn pixels, never on CSS boxes\" rule. Map mode, not sphere: this is " +
      "the mode where the default view has zero pan room but real zoom room (`globe-expanded-map`'s own cursor " +
      'check), so it also stands as a second, independent proof (alongside `globe-sphere-zoom-past-fit`) that the ' +
      'zoom buttons drive the same real camera distance in both modes. Uses `drawnPixelDiff` (the same primitive ' +
      "the arrival-arc shots below use) rather than a `drawnBounds` width comparison: map mode's own default view " +
      "already fills nearly all of `GLOBE_CHROME_FREE_STRIP`'s own safe width (`globe-expanded-map`'s ~1213px own " +
      'default, against the strip\'s 1320px), leaving too little headroom for one zoom step to show as further ' +
      "*growth* there (browser-verified: both before and after saturated the strip identically). A pixel diff has " +
      'no such ceiling — zooming the camera in changes what the *whole* globe render shows regardless of how much ' +
      "spare width remains, while any *unchanged* chrome pixels a wider clip might otherwise sweep in (the " +
      '"Globe/Map" toggle, legend, close button, zoom controls) contribute nothing to the diff either way, so the ' +
      'full canvas can be diffed directly with no clip needed at all.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    measure: async ({ page, hook }) => {
      const { diffPixels, diffFraction } = await drawnPixelDiff(page, GLOBE_CANVAS_SELECTOR, async () => {
        await page.getByRole('button', { name: 'Zoom in' }).click()
        await rafTicks(page, 2)
        await hook.ready()
      })
      return { diffPixels, diffFraction }
    },
    // A single zoom step moves the camera enough to redraw a large fraction of the map — set
    // well below this shot's own measured count, comfortably above screenshot/PNG round-trip
    // noise (`countDiffPixels`'s own threshold already filters that).
    expect: { diffPixels: [5000, 2_000_000] },
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
    name: 'globe-click-does-not-close',
    description:
      'BUG 1 (user verbatim: "clicking on the map or globe in fullscreen mode closes it which is probalby not ' +
      'expected behaviour"). Root cause: `globeGeometry.ts`\'s mesh carries no `position` attribute, so three.js\'s ' +
      'default raycast always misses it, and `Globe.tsx`\'s `<Canvas onPointerMissed>` trusted every miss to mean ' +
      '"clicked the backdrop, close it" — so *every* plain click on the globe itself, not just the transparent ' +
      "backdrop around it, closed the view. Fixed with an analytic proxy raycast (`camera.ts`'s " +
      '`globeBodyProxyHit`). A single stationary click (`page.mouse.click`, no movement — matches r3f\'s own ' +
      '`delta <= 2px` "was this a click or a drag" gate) dead-centre on the sphere\'s own drawn silhouette must ' +
      'leave the globe expanded.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      // Settle first: `actions` runs *before* the runner's own `ready()`/`rafTicks` wait
      // (`run.mjs`'s own comment on the order), so the sphere's real fit-frame box isn't
      // guaranteed final yet here — reading it too early (mid fade-in, or before the
      // `ResizeObserver` measurement that drives `GlobeCameraControls`'s own fit has fired) risks
      // clicking a stale or degenerate box. Also waits out a full `waitForApproxUnfoldProgress(
      // page, 1)`, not just a couple of `rafTicks`: this harness never reloads between shots
      // (README), and the immediately-preceding `globe-transition-mid-unfold` shot deliberately
      // leaves the page mid-tween under real (`no-preference`) motion — browser-verified
      // regression this fix replaces: without the full settle wait, this shot's own click could
      // land while `unfold` was still mid-transition, well before the sphere's fit-frame box (and
      // the analytic proxy raycast's own sphere/map shape switch) had actually settled to sphere
      // mode.
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
      const box = await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    },
    measure: async ({ hook }) => ({ expanded: (await hook.getState())?.globeExpanded ? 1 : 0 }),
    expect: { expanded: [1, 1] },
  },
  {
    name: 'globe-click-on-map-does-not-close',
    description: 'Same as `globe-click-does-not-close`, in map mode — the proxy raycast swaps to the map\'s own flat rectangle there.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    actions: async ({ page, hook }) => {
      // Settle first (`globe-click-does-not-close`'s own comment, including the shot-ordering
      // "why a full unfold-progress wait, not just a couple of frames" reasoning).
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
      const box = await hiddenBoxOf(page, GLOBE_MAP_FIT_FRAME_SELECTOR)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    },
    measure: async ({ hook }) => ({ expanded: (await hook.getState())?.globeExpanded ? 1 : 0 }),
    expect: { expanded: [1, 1] },
  },
  {
    name: 'globe-click-on-backdrop-still-closes',
    description:
      'Regression guard for the `globe-click-does-not-close` fix: a plain click on the dimmed, empty backdrop ' +
      '*around* the globe (nowhere near the sphere\'s own drawn silhouette, the legend, or the bottom-centre ' +
      'Globe/Map toggle) must still close the expanded view — the one intended use of `onPointerMissed`, which the ' +
      "fix must not have broken by making the proxy raycast too generous. (150, 700) at 1440x900: well left of the " +
      "sphere's own centred silhouette, well below the legend's own short content.",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page }) => {
      await page.mouse.click(150, 700)
    },
    measure: async ({ hook }) => ({ expanded: (await hook.getState())?.globeExpanded ? 1 : 0 }),
    expect: { expanded: [0, 0] },
  },
  {
    name: 'globe-map-drag-pans-when-zoomed',
    description:
      'BUG 2 (user verbatim: "dragging of the expanded map doesnt work when zoomed in (shouldbe able to drag when ' +
      'zoomed but not when fully zoomed out)"). Root cause: `OrbitControls`\'s own default `mouseButtons` routes a ' +
      "plain left-drag to `ROTATE` unconditionally; map mode sets `enableRotate={false}`, so three.js's own " +
      '`onMouseDown` hit that disabled-rotate early return and did *nothing* — not "panned with no room", never ' +
      "even reaching `_handleMouseDownPan` — regardless of zoom level. `camera.ts`'s `mapHasPanRoom` was already " +
      'correctly wired into the cursor (`globe-expanded-map`\'s own `cursorIsNotGrab` check); the gesture routing ' +
      "was the actual gap. Fixed by setting `mouseButtons.LEFT`/`touches.ONE` to `PAN` while `mapMode`. Zooms in " +
      'four steps (past the point `mapHasPanRoom` goes true), then drags and diffs the canvas\'s own drawn pixels ' +
      "before/after (`drawnPixelDiff`, the same primitive `globe-zoom-button-changes-drawn-size` uses) — proof " +
      'the drag actually moved the camera, not just that it failed to crash.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    actions: async ({ page, hook }) => {
      const zoomIn = page.getByRole('button', { name: 'Zoom in' })
      for (let i = 0; i < 4; i += 1) {
        await zoomIn.click()
        await rafTicks(page, 2)
      }
      await hook.ready()
    },
    measure: async ({ page, hook }) => {
      const { diffPixels } = await drawnPixelDiff(page, GLOBE_CANVAS_SELECTOR, async () => {
        const box = await page.locator(GLOBE_CANVAS_SELECTOR).first().boundingBox()
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + 180, cy, { steps: 12 })
        await page.mouse.up()
        await rafTicks(page, 2)
      })
      return { diffPixels, expanded: (await hook.getState())?.globeExpanded ? 1 : 0 }
    },
    // Comfortably above `globe-zoom-button-changes-drawn-size`'s own noise floor; a drag this far
    // (180px, well beyond the pan clamp at this zoom level) must redraw a real fraction of the map.
    expect: { diffPixels: [5000, 2_000_000], expanded: [1, 1] },
  },
  {
    name: 'globe-map-drag-does-nothing-when-fully-zoomed-out',
    description:
      'BUG 2\'s other half (user verbatim: "shouldbe able to drag when zoomed but not when fully zoomed out"): at ' +
      "the default, fully-zoomed-out map view (`mapHasPanRoom` false — `globe-expanded-map`'s own `cursorIsNotGrab` " +
      'check), dragging must still do nothing — panning has genuinely nowhere to go there, so the fix for BUG 2 ' +
      "must not have also made a no-room drag do something. Same drag, no prior zoom; diffPixels stays in the " +
      "screenshot/PNG round-trip noise floor `countDiffPixels`'s own threshold already filters, well below a real " +
      'redraw. Forces a clean default zoom by round-tripping sphere->map (entering map mode always tweens the ' +
      "camera to `mapFit`, `GlobeCameraControls`'s own settle logic) rather than trusting the page's starting zoom " +
      "— this harness never reloads between shots (README), so without this reset a *previous* shot's own zoom " +
      "(e.g. `globe-map-drag-pans-when-zoomed`, which zooms in on purpose) can still be sitting on the camera " +
      'when this one starts, since neither `globeExpanded` nor `globeViewMode` actually change value between them ' +
      '(`applyState`\'s own reset logic only fires on a real transition).',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    actions: async ({ page, hook }) => {
      await hook.setGlobeViewMode('globe')
      await hook.setGlobeViewMode('map')
      await hook.ready()
      // A full settle, not just a couple of frames (`globe-click-does-not-close`'s own "why" —
      // this harness never reloads between shots, so the round-trip tween just triggered must be
      // given its own real ~0.8s before the "fully zoomed out" premise below is trustworthy).
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
    },
    measure: async ({ page }) => {
      const { diffPixels } = await drawnPixelDiff(page, GLOBE_CANVAS_SELECTOR, async () => {
        const box = await page.locator(GLOBE_CANVAS_SELECTOR).first().boundingBox()
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + 180, cy, { steps: 12 })
        await page.mouse.up()
        await rafTicks(page, 2)
      })
      return { diffPixels }
    },
    expect: { diffPixels: [0, 3000] },
  },
  {
    name: 'globe-view-mode-toggle-clear-of-sphere',
    description:
      'Issue 3 follow-up defect 1 (user report on the first pass: "the globe/map toggle is overlayed on top of ' +
      'the globe (should be under, globe needs to be made a bit smaller)"). `sphere` is measured by drawn pixels ' +
      "(`drawnBoundsInClip` over the real fit-frame rectangle, exactly `globe-expanded-sphere`'s own proven-sound " +
      "technique — CLAUDE.md's own warning about `drawnBounds` over a busy photographic backdrop is about scanning " +
      "an *unclipped* full-viewport canvas; clipped tightly to the fit frame, the clip's own corners are the " +
      'dark backdrop just outside the circular silhouette, which is exactly what makes this technique sound here); ' +
      '`toggle` is a plain CSS box (`boxOf`) since it is ordinary bordered-pill HUD chrome, not a canvas. The gap ' +
      'between them must be strictly positive.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    // A full settle, not the default flow's couple of frames — this harness never reloads
    // between shots (README), so a still-running sphere<->map tween left by whichever shot ran
    // immediately before this one (view mode or `globeExpanded` can both trigger one) would
    // otherwise still be moving when the fit-frame box below is read.
    actions: async ({ page, hook }) => {
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
    },
    measure: async ({ page }) => {
      const sphere = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR))
      const toggle = await boxOf(page, VIEW_MODE_TOGGLE_SELECTOR)
      return { clearanceGapPx: toggle.y - (sphere.y + sphere.height), sphereDiameterPx: sphere.height }
    },
    expect: { clearanceGapPx: [4, 400] },
  },
  {
    name: 'globe-view-mode-toggle-clear-of-map',
    description: 'Same as `globe-view-mode-toggle-clear-of-sphere`, in map mode, against the real map fit frame.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    actions: async ({ page, hook }) => {
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
    },
    measure: async ({ page }) => {
      const map = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_MAP_FIT_FRAME_SELECTOR))
      const toggle = await boxOf(page, VIEW_MODE_TOGGLE_SELECTOR)
      return { clearanceGapPx: toggle.y - (map.y + map.height) }
    },
    expect: { clearanceGapPx: [4, 400] },
  },
  {
    name: 'globe-view-mode-toggle-clear-of-sphere-narrow',
    description: 'Same as `globe-view-mode-toggle-clear-of-sphere`, at the narrow 390x844 phone-portrait viewport.',
    viewport: { width: 390, height: 844 },
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
    },
    measure: async ({ page }) => {
      const sphere = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR))
      const toggle = await boxOf(page, VIEW_MODE_TOGGLE_SELECTOR)
      return { clearanceGapPx: toggle.y - (sphere.y + sphere.height) }
    },
    expect: { clearanceGapPx: [4, 400] },
  },
  {
    name: 'globe-view-mode-toggle-clear-of-sphere-short',
    description:
      'Same as `globe-view-mode-toggle-clear-of-sphere`, at the short 844x390 landscape-phone viewport — the ' +
      'tightest of this feature\'s own required viewports for vertical chrome-gap headroom.',
    viewport: { width: 844, height: 390 },
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
    },
    measure: async ({ page }) => {
      const sphere = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR))
      const toggle = await boxOf(page, VIEW_MODE_TOGGLE_SELECTOR)
      return { clearanceGapPx: toggle.y - (sphere.y + sphere.height) }
    },
    expect: { clearanceGapPx: [4, 400] },
  },
  {
    name: 'globe-view-mode-toggle-clickable',
    description:
      'Issue 3 follow-up defect 2 (user report: "and currnetly isnt clickable"). Root cause: `ShellLayout.module.' +
      'css`\'s `.bottom > *` re-enabled `pointer-events` on the whole of `.stage`, a box deliberately sized to its ' +
      "tallest grid-cell child including a hidden sibling nobody can see (`ShellLayout.tsx`'s own `useChromeGap` " +
      'doc comment) — that invisible overflow, promoted to `z-index: 60` above the entire backdrop, sat over the ' +
      "toggle and ate its clicks. A real Playwright `locator.click()` (not `devHook.ts`'s `setGlobeViewMode`, " +
      "which drives the DOM `button.click()` API directly and so bypasses real hit-testing/`pointer-events` " +
      "entirely — proving nothing about clickability) on the actual \"Map\" button, then reading the mode back " +
      "through the hook: if anything still covers the button, Playwright's own actionability check fails the " +
      'click outright (this shot errors, not just its `expect`) rather than silently clicking through.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      // Full settle first (the four `globe-view-mode-toggle-clear-of-*` shots' own comment) —
      // not load-bearing for clickability itself, but the button's own position could still be
      // mid-tween otherwise, which risks Playwright's actionability wait racing a moving target.
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
      await page.locator(VIEW_MODE_TOGGLE_SELECTOR).getByRole('button', { name: 'Map' }).click()
    },
    measure: async ({ hook }) => ({ mode: (await hook.getGlobeViewMode()) === 'map' ? 1 : 0 }),
    expect: { mode: [1, 1] },
  },
  {
    name: 'globe-view-mode-toggle-no-view-label',
    description:
      'User ask, 2026-09-18: "remove the redudantn \'view\' label on the globe/map toggle". The toggle\'s own ' +
      "group keeps an accessible name (`aria-label=\"Globe/Map view\"`, replacing the removed label's " +
      '`aria-labelledby`) but must draw no "View" text anywhere while expanded.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page }) => {
      const toggleText = await page.locator(VIEW_MODE_TOGGLE_SELECTOR).innerText()
      const hasViewWord = /\bview\b/i.test(toggleText)
      // `aria-label` sits on the inner `[role="group"]` (the two buttons' own group), not the
      // outer `VIEW_MODE_TOGGLE_SELECTOR` element (which only exists for height measurement).
      const groupLabel = await page.locator(`${VIEW_MODE_TOGGLE_SELECTOR} [role="group"]`).getAttribute('aria-label')
      return { hasViewWord: hasViewWord ? 1 : 0, hasAccessibleName: groupLabel !== null && groupLabel !== '' ? 1 : 0 }
    },
    expect: { hasViewWord: [0, 0], hasAccessibleName: [1, 1] },
  },
  {
    name: 'view-mode-toggle-clear-of-pip-hover-preview',
    description:
      'User correction, 2026-09-18: "the globe/map toglge butotns cant go any further dowanrds closer to timeline ' +
      'cause need space for the hover labels" — the scrub track\'s own checkpoint-pip hover preview ' +
      "(`ScrubTrack.tsx`'s `.pipPreview`, the same one `timeline-pip-thumbnail-hover` already knows how to " +
      'trigger, reused here rather than inventing a second hover mechanism) rides above the track and must clear ' +
      "the expanded globe's own Globe/Map toggle beneath it — an intermittent, hover-only overlap no resting-" +
      'layout screenshot would ever catch, which is exactly why a static assertion on the toggle\'s own position ' +
      'alone is not enough here; this one actually triggers the hover and measures the real, visible preview card.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => {
      await hook.ready()
      await waitForApproxUnfoldProgress(page, 1)
      await rafTicks(page, 2)
      await page.locator(CHECKPOINT_PIP_SELECTOR).first().hover()
    },
    measure: async ({ page }) => {
      const preview = await boxOf(page, PIP_PREVIEW_SELECTOR)
      const toggle = await boxOf(page, VIEW_MODE_TOGGLE_SELECTOR)
      return { overlapsToggle: rectsOverlap(preview, toggle) ? 1 : 0 }
    },
    expect: { overlapsToggle: [0, 0] },
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
    name: 'bottom-chrome-height',
    description:
      'Condensing pass (2026-09-18, user report: "reduce the vertical footprint of the bottom ' +
      'chrome"): the <Timeline> control\'s own drawn height (scrub track, ruler, section bands, ' +
      'transport row — not the scene caption above it, a separate ShellLayout slot) at 1440x900, ' +
      "present day. Was ~194px before the pass (the dismissible first-use hint's own row plus " +
      'generous inter-row gaps/margins); a regression back toward that — or an over-eager future ' +
      'cut that starts clipping/overlapping rows — should fail this band. Still measures 152px ' +
      "through two later passes that each had a real chance to move it: era shortcuts' own third " +
      'and final placement, landing back in `.controlsSections` alongside the breadcrumb rather ' +
      "than adding a row (`EraShortcuts.tsx`'s own doc comment has the full placement history), " +
      'and the play button\'s "slightly larger" nudge (user ask, 2026-09-18) from 44px to 48px — ' +
      "checked, not assumed: `.controlsSecondary` (sound/speed/mode/scale/rate-badge) already " +
      'wraps to 2 rows at 54px tall, taller than either the old or the new play button, so ' +
      "`.controlsRow`'s own height was already set by that track, not `.core`'s — growing the play " +
      'button by 4px genuinely cost this band nothing.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page }) => ({ timeline: await drawnBounds(page, BOTTOM_CHROME_SELECTOR) }),
    expect: { 'timeline.height': [135, 175] },
  },
  {
    name: 'viewport-1024x768',
    description: 'Common laptop viewport sanity check — default view, plus the same bottom-chrome height guard at this width.',
    viewport: { width: 1024, height: 768 },
    t: 0,
    measure: async ({ page }) => ({ timeline: await drawnBounds(page, BOTTOM_CHROME_SELECTOR) }),
    expect: { 'timeline.height': [150, 205] },
  },
  {
    name: 'viewport-390x844-phone-portrait',
    description:
      'Phone portrait sanity check — default view, ancestor panel collapse behaviour, plus the same ' +
      'bottom-chrome height guard (a taller band here: the breadcrumb and secondary controls stack ' +
      'into their own rows below 760px, DESIGN §8).',
    viewport: { width: 390, height: 844 },
    t: 0,
    measure: async ({ page }) => ({ timeline: await drawnBounds(page, BOTTOM_CHROME_SELECTOR) }),
    expect: { 'timeline.height': [230, 310] },
  },
  {
    name: 'era-shortcuts-group',
    description:
      'The Dinosaurs/Humans "jump to an era" shortcut group. Lives inside ' +
      "`TIMELINE_CONTROLS_SECONDARY_SELECTOR` (`Timeline.tsx`'s `.controlsSecondary`, alongside the speed/mode/" +
      'scale controls), inside `BOTTOM_CHROME_SELECTOR` — moved there from `.controlsSections` (beside the ' +
      'breadcrumb) so the breadcrumb track has the left side of the row to itself.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page }) => {
      const insideSecondary = await page.evaluate(
        ([shortcutsSel, secondarySel]) => {
          const shortcuts = document.querySelector(shortcutsSel)
          const secondary = document.querySelector(secondarySel)
          return shortcuts !== null && secondary !== null && secondary.contains(shortcuts)
        },
        [ERA_SHORTCUTS_SELECTOR, TIMELINE_CONTROLS_SECONDARY_SELECTOR],
      )
      return {
        shortcuts: await drawnBounds(page, ERA_SHORTCUTS_SELECTOR),
        insideSecondary: insideSecondary ? 1 : 0,
      }
    },
    expect: {
      // Two pills wide enough to hold an icon and a caps-mono label, unmistakably present.
      'shortcuts.width': [90, 320],
      'shortcuts.height': [16, 60],
      insideSecondary: [1, 1],
    },
  },
  {
    name: 'era-shortcuts-clear-of-neighbours-wide',
    description:
      'The relocated era shortcuts (`era-shortcuts-group`\'s own description) must not overlap the breadcrumb ' +
      'or the transport core (play/back/forward) — self-overlap against `.controlsSecondary`\'s own other ' +
      "children (sound/speed/mode/scale) is `controls-secondary-no-self-overlap-*`'s job, not this shot's, since " +
      "the shortcuts are now themselves one of those children. Plain CSS boxes (`boxOf`), not drawn-pixel scans: " +
      "every element here is ordinary HUD chrome over the shell's own layout, not a canvas whose CSS box could " +
      "diverge from what's painted inside it.",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page }) => {
      const shortcuts = await boxOf(page, ERA_SHORTCUTS_SELECTOR)
      const breadcrumb = await boxOf(page, BREADCRUMB_SELECTOR)
      const core = await boxOf(page, TIMELINE_CONTROLS_CORE_SELECTOR)
      return {
        overlapsBreadcrumb: rectsOverlap(shortcuts, breadcrumb) ? 1 : 0,
        overlapsCore: rectsOverlap(shortcuts, core) ? 1 : 0,
      }
    },
    expect: { overlapsBreadcrumb: [0, 0], overlapsCore: [0, 0] },
  },
  {
    name: 'era-shortcuts-clear-of-neighbours-narrow',
    description: 'Same as `era-shortcuts-clear-of-neighbours-wide`, at the narrow 390x844 phone-portrait viewport.',
    viewport: { width: 390, height: 844 },
    t: 0,
    measure: async ({ page }) => {
      const shortcuts = await boxOf(page, ERA_SHORTCUTS_SELECTOR)
      const breadcrumb = await boxOf(page, BREADCRUMB_SELECTOR)
      const core = await boxOf(page, TIMELINE_CONTROLS_CORE_SELECTOR)
      return {
        overlapsBreadcrumb: rectsOverlap(shortcuts, breadcrumb) ? 1 : 0,
        overlapsCore: rectsOverlap(shortcuts, core) ? 1 : 0,
      }
    },
    expect: { overlapsBreadcrumb: [0, 0], overlapsCore: [0, 0] },
  },
  {
    name: 'era-shortcuts-clear-of-neighbours-short',
    description:
      'Same as `era-shortcuts-clear-of-neighbours-wide`, at the short 844x390 landscape-phone viewport (one of ' +
      "docs/GLOBE.md's own required viewports for exactly this kind of tight-space check).",
    viewport: { width: 844, height: 390 },
    t: 0,
    measure: async ({ page }) => {
      const shortcuts = await boxOf(page, ERA_SHORTCUTS_SELECTOR)
      const breadcrumb = await boxOf(page, BREADCRUMB_SELECTOR)
      const core = await boxOf(page, TIMELINE_CONTROLS_CORE_SELECTOR)
      return {
        overlapsBreadcrumb: rectsOverlap(shortcuts, breadcrumb) ? 1 : 0,
        overlapsCore: rectsOverlap(shortcuts, core) ? 1 : 0,
      }
    },
    expect: { overlapsBreadcrumb: [0, 0], overlapsCore: [0, 0] },
  },
  {
    name: 'controls-secondary-no-self-overlap-wide',
    description:
      'The specific regression risk the coordinator named for era shortcuts\' third placement: adding them ' +
      "to `.controlsSecondary` first (measured, then rejected — that class's own Timeline.module.css doc comment " +
      'has the numbers) pushed it from 2 wrapped rows to 3 at 1440x900; even with the shortcuts moved elsewhere, ' +
      "this guards that `.controlsSecondary`'s own pre-existing children (sound toggle, speed select, mode " +
      'group, scale group, rate readout row) never overlap each other — the root-cause fix for the historical ' +
      '"the mute/volume button overlaps with the next/fast forward button" report, which this change sits ' +
      'immediately next to. `countOverlappingChildPairs` counts overlapping direct-child pairs, not wrapped rows ' +
      '(two children on different flex lines never overlap in `y`, so wrapping itself never trips this).',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page }) => ({
      overlappingPairs: await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR }),
    }),
    expect: { overlappingPairs: [0, 0] },
  },
  {
    name: 'controls-secondary-no-self-overlap-narrow',
    description: 'Same as `controls-secondary-no-self-overlap-wide`, at the narrow 390x844 phone-portrait viewport.',
    viewport: { width: 390, height: 844 },
    t: 0,
    measure: async ({ page }) => ({
      overlappingPairs: await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR }),
    }),
    expect: { overlappingPairs: [0, 0] },
  },
  {
    name: 'controls-secondary-no-self-overlap-short',
    description: 'Same as `controls-secondary-no-self-overlap-wide`, at the short 844x390 landscape-phone viewport.',
    viewport: { width: 844, height: 390 },
    t: 0,
    measure: async ({ page }) => ({
      overlappingPairs: await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR }),
    }),
    expect: { overlappingPairs: [0, 0] },
  },
  {
    name: 'timeline-controls-inset-to-track-wide',
    description:
      'User report, 2026-09-18: "maybe cosntrian the horizotan layout of hte bottom row (breadcrumb, nav buttons, ' +
      'mode/scale toggles) so tehy are constrained within the horizotanl boudns of the timeline and era selector ' +
      "and dont flow beyond them (so theres more padding on the sides)\". Root cause: `SectionEdgeNav.module.css`'s " +
      '`.stack` insets the scrub track/ruler/band strip by a real gutter (`--edge-button-size` + `--edge-button-' +
      "gap`, for the prev/next edge buttons), but `.controlsRow` below it had no matching inset, so the breadcrumb " +
      "(left) and mode/scale/sound controls (right) visibly overhung the track they sit under. Fixed with one " +
      'shared `--timeline-gutter` custom property (`Timeline.module.css`\'s `.timeline`), consumed by both ' +
      "`.stack` and `.controlsRow` instead of two hand-written copies of the same `calc()`. Measures the real " +
      "rendered boxes (`boxOf` — ordinary flex/grid HUD chrome, ,not a canvas, so a CSS box is exactly what's " +
      'painted): the breadcrumb\'s own left edge must sit at or inside the track\'s left edge, and the secondary ' +
      "controls' own right edge at or inside the track's right edge. Also checks `.controlsCore` (the play-button " +
      "group) stays centred on the *track*'s own centre, not just the row's — the coordinator's own explicit " +
      'concern: a symmetric inset on a 3-track `minmax(0, 1fr) auto minmax(0, 1fr)` grid must not unbalance the ' +
      'centring `.controlsRow`\'s own doc comment already relies on.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page }) => {
      const track = await boxOf(page, TIMELINE_TRACK_STACK_SELECTOR)
      const sections = await boxOf(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)
      const secondary = await boxOf(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      const core = await boxOf(page, TIMELINE_CONTROLS_CORE_SELECTOR)
      return {
        // Positive means the breadcrumb starts inside (to the right of) the track's own left
        // edge; 0 means exactly flush; negative means it still overhangs.
        leftInsetPx: sections.x - track.x,
        rightInsetPx: track.x + track.width - (secondary.x + secondary.width),
        coreCenterOffsetPx: Math.abs(core.x + core.width / 2 - (track.x + track.width / 2)),
        secondaryHeightPx: secondary.height,
      }
    },
    expect: {
      leftInsetPx: [0, 400],
      rightInsetPx: [0, 400],
      coreCenterOffsetPx: [0, 3],
      // A generous single/double-row ceiling — `.controlsSecondary`'s own load-bearing
      // `flex-wrap` (this file's own doc comment) is allowed to wrap, but a real 1440x900
      // regression would wrap far more than this.
      secondaryHeightPx: [0, 90],
    },
  },
  {
    name: 'timeline-controls-inset-to-track-narrow',
    description: 'Same as `timeline-controls-inset-to-track-wide`, at the narrow 390x844 phone-portrait viewport.',
    viewport: { width: 390, height: 844 },
    t: 0,
    measure: async ({ page }) => {
      const track = await boxOf(page, TIMELINE_TRACK_STACK_SELECTOR)
      const sections = await boxOf(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)
      const secondary = await boxOf(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      return {
        leftInsetPx: sections.x - track.x,
        rightInsetPx: track.x + track.width - (secondary.x + secondary.width),
      }
    },
    // The narrow breakpoint stacks sections/core/secondary into one centred column (this file's
    // own `@media (max-width: 760px)` rule) rather than a 3-track row, so both sides are centred
    // within the same inset track width rather than pinned to its exact edges.
    // `rightInsetPx`'s own floor is `-6`, not `0`: browser-verified, at this exact 390px floor
    // `.controlsSecondary`'s own first wrapped line (`TransportSecondary` + `.scaleGroup`) is a
    // genuine few px wider than the inset track even after `flex-wrap`/gap tightening
    // (`Timeline.module.css`'s own `.controlsSecondary` narrow-breakpoint comment has the
    // measured story) — a small, pre-existing content-fit characteristic at the single narrowest
    // supported width, not the overhang the user actually reported (which was tens to hundreds
    // of px, visible at ordinary/wide viewing, and is what this whole shot family exists to
    // guard). `-6` still catches any *real* regression (an un-inset row here would overhang by
    // roughly a whole `--timeline-gutter`, ~50-56px, not a handful).
    expect: { leftInsetPx: [0, 400], rightInsetPx: [-6, 400] },
  },
  {
    name: 'timeline-controls-inset-to-track-short',
    description:
      'Same as `timeline-controls-inset-to-track-wide`, at the short 844x390 landscape-phone viewport (one of ' +
      "docs/GLOBE.md's own required viewports for tight horizontal/vertical space together).",
    viewport: { width: 844, height: 390 },
    t: 0,
    measure: async ({ page }) => {
      const track = await boxOf(page, TIMELINE_TRACK_STACK_SELECTOR)
      const sections = await boxOf(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)
      const secondary = await boxOf(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      return {
        leftInsetPx: sections.x - track.x,
        rightInsetPx: track.x + track.width - (secondary.x + secondary.width),
      }
    },
    expect: { leftInsetPx: [0, 400], rightInsetPx: [0, 400] },
  },
  {
    name: 'controls-row-single-line-wide',
    description:
      'The breadcrumb in `.controlsSections`, and the era shortcuts/mode toggle/scale toggle — the three ' +
      "interactive groups in `.controlsSecondary` a viewer actually clicks — stay on one line at 1440x900, at " +
      'the exact full breadcrumb trail (Earth > Cenozoic > Quaternary > Holocene > Modern, t=50) that produced ' +
      "the reported regression. `.controlsSecondary`'s own doc comment explains why the trailing, always-" +
      'reserved-but-usually-empty rate-badge row is exempt from this: `firstChildrenShareRow` checks only the ' +
      'first 3 children, not the 4th.',
    viewport: DEFAULT_VIEWPORT,
    t: 50,
    measure: async ({ page }) => {
      const sectionsRows = await page.evaluate(countDistinctRows, { containerSelector: TIMELINE_CONTROLS_SECTIONS_SELECTOR })
      const secondaryFirstThreeShareRow = await page.evaluate(firstChildrenShareRow, {
        containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR,
        n: 3,
      })
      return { sectionsRows, secondaryFirstThreeShareRow: secondaryFirstThreeShareRow ? 1 : 0 }
    },
    expect: { sectionsRows: [1, 1], secondaryFirstThreeShareRow: [1, 1] },
  },
  {
    name: 'controls-row-narrow-desktop-no-collision',
    description:
      'At 844x390 (a landscape-phone viewport above the 760px breakpoint, so still the desktop 3-track row, not ' +
      "the stacked layout) there is genuinely not enough width for the breadcrumb's own track plus era " +
      "shortcuts/mode/scale all on one line — `.controlsSecondary`'s own `flex-wrap` safety net legitimately " +
      'engages here, same as it always could pre-rearrange. The requirement at this width is what ' +
      '`controls-secondary-no-self-overlap-short` and `timeline-controls-inset-to-track-short` already guard: no ' +
      "child collides with another and nothing overflows the track's own gutter bounds. This shot is the same " +
      "check restated with the full-breadcrumb worst case (t=50) those two don't use, so the wrap this width " +
      'produces is confirmed collision-free under that case too, not just the shallower default t=0.',
    viewport: { width: 844, height: 390 },
    t: 50,
    measure: async ({ page }) => {
      const sectionsOverlaps = await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECTIONS_SELECTOR })
      const secondaryOverlaps = await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR })
      const track = await boxOf(page, TIMELINE_TRACK_STACK_SELECTOR)
      const secondary = await boxOf(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      return {
        sectionsOverlaps,
        secondaryOverlaps,
        rightOverflowPx: secondary.x + secondary.width - (track.x + track.width),
      }
    },
    expect: { sectionsOverlaps: [0, 0], secondaryOverlaps: [0, 0], rightOverflowPx: [-400, 0] },
  },
  {
    name: 'controls-row-narrow-stacked-no-collision',
    description:
      'Below the 760px breakpoint the row restructures into a stacked, centred column that is allowed to wrap ' +
      '(`Timeline.module.css`\'s own `@media (max-width: 760px)` rule) — this checks the narrow 390x844 phone ' +
      'viewport degrades to that wrap-tolerant layout without any child colliding with another, rather than ' +
      'asserting the single-line requirement that only applies to the wider, 3-track layout above.',
    viewport: { width: 390, height: 844 },
    t: 50,
    measure: async ({ page }) => {
      const sectionsOverlaps = await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECTIONS_SELECTOR })
      const secondaryOverlaps = await page.evaluate(countOverlappingChildPairs, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR })
      return { sectionsOverlaps, secondaryOverlaps }
    },
    expect: { sectionsOverlaps: [0, 0], secondaryOverlaps: [0, 0] },
  },
  {
    name: 'transport-core-optically-centred',
    description:
      'The back/play/forward transport group must stay optically centred on the scrub track regardless of how ' +
      'wide the breadcrumb or the secondary controls happen to be — `.controlsRow`\'s own symmetric ' +
      '`minmax(0, 1fr) auto minmax(0, 1fr)` grid is what keeps this true. Same full-breadcrumb worst case as ' +
      '`controls-row-single-line-wide`.',
    viewport: DEFAULT_VIEWPORT,
    t: 50,
    measure: async ({ page }) => {
      const track = await boxOf(page, TIMELINE_TRACK_STACK_SELECTOR)
      const core = await boxOf(page, TIMELINE_CONTROLS_CORE_SELECTOR)
      return { offsetPx: Math.abs(core.x + core.width / 2 - (track.x + track.width / 2)) }
    },
    expect: { offsetPx: [0, 3] },
  },
  {
    name: 'controls-secondary-fixed-position-across-breadcrumb-lengths',
    description:
      'The actual bug this rearrange fixes: the centre cluster (sound, back/play/forward, speed — ' +
      '`TIMELINE_CONTROLS_CORE_SELECTOR`) and the right cluster (era shortcuts, playback mode, scale, rate badge ' +
      '— `TIMELINE_CONTROLS_SECONDARY_SELECTOR`) must sit at identical pixel positions whether the breadcrumb ' +
      'reads plain "Earth" (t=0) or the full "Earth > Cenozoic > Quaternary > Holocene > Modern" trail (t=50) — ' +
      "`.controlsSections` is the row's one flexible column precisely so a longer trail never moves anything in " +
      "either fixed-width cluster beside it. `childPositions` reads every direct child's own `{x, y}`.",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page, hook }) => {
      const shortCore = await page.evaluate(childPositions, { containerSelector: TIMELINE_CONTROLS_CORE_SELECTOR })
      const shortSecondary = await page.evaluate(childPositions, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR })
      await hook.setT(50)
      await hook.ready()
      const longCore = await page.evaluate(childPositions, { containerSelector: TIMELINE_CONTROLS_CORE_SELECTOR })
      const longSecondary = await page.evaluate(childPositions, { containerSelector: TIMELINE_CONTROLS_SECONDARY_SELECTOR })
      const driftOf = (a, b) =>
        a.length === b.length && a.length > 0 ? Math.max(...a.map((p, i) => Math.max(Math.abs(p.x - b[i].x), Math.abs(p.y - b[i].y)))) : Infinity
      return {
        coreChildCount: shortCore.length,
        secondaryChildCount: shortSecondary.length,
        coreMaxDriftPx: driftOf(shortCore, longCore),
        secondaryMaxDriftPx: driftOf(shortSecondary, longSecondary),
      }
    },
    expect: {
      coreChildCount: [3, 3],
      secondaryChildCount: [3, 5],
      coreMaxDriftPx: [0, 0],
      secondaryMaxDriftPx: [0, 0],
    },
  },
  {
    name: 'era-shortcut-dinosaurs-selected',
    description:
      'Clicking the "Dinosaurs" shortcut behaves exactly like selecting the Mesozoic band by hand: the breadcrumb ' +
      'shows the real geological name (never the nickname), the section-band strip switches to the Mesozoic\'s own ' +
      'children (Triassic/Jurassic/Cretaceous), and `t` jumps to the section\'s oldest edge — the same "zoom in and ' +
      'narrow" ADR-024 already gives every band/breadcrumb selection.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    actions: async ({ page }) => {
      await page.getByRole('button', { name: /^Dinosaurs — /, exact: false }).click()
    },
    measure: async ({ page, hook }) => {
      const state = await hook.getState()
      const breadcrumbCurrent = (await page.textContent(BREADCRUMB_CURRENT_SELECTOR))?.trim() ?? null
      const bandsAriaLabel = await page.getAttribute(SECTION_BANDS_SELECTOR, 'aria-label')
      return {
        sectionId: state?.sectionId ?? null,
        t: state?.t ?? null,
        breadcrumbCurrent,
        bandsAriaLabel,
        sectionIsMesozoic: state?.sectionId === 'mesozoic' ? 1 : 0,
        breadcrumbShowsMesozoic: breadcrumbCurrent === 'Mesozoic' ? 1 : 0,
        bandsShowMesozoicChildren: bandsAriaLabel === 'Sections of Mesozoic' ? 1 : 0,
      }
    },
    expect: {
      sectionIsMesozoic: [1, 1],
      breadcrumbShowsMesozoic: [1, 1],
      bandsShowMesozoicChildren: [1, 1],
      // The Mesozoic's own cited base age (sections.ts: 251.902 Ma) — `t` lands on the
      // section's oldest edge, matching `sectionEntryT`'s "outside -> jump to start" rule.
      t: [251_901_000, 251_903_000],
    },
  },
  {
    name: 'population-chart-present',
    description:
      'Population HUD sparkline expanded to its full chart (user ask, 2026-09-18: "a small historical graph of ' +
      'population history beneath the current count, like for the CO2 levels") at t=10, the layer\'s newest sample ' +
      '(~7.3 billion, 2015 CE) — reuses the exact click-to-expand `LayerChart` CO2 already had. Navigates through ' +
      'the real "Humans" era shortcut first (Holocene window) so the x-axis actually covers population\'s own ' +
      "10,000 BCE-2015 CE domain, the way a person would actually reach this view, rather than the sliver it'd be " +
      'against the full 4.6 Gyr domain. The y-axis is log-scaled (~1,600x range, `chartAxis.ts`) and says so.',
    viewport: DEFAULT_VIEWPORT,
    t: 10,
    // Idempotent by design: this harness runs every shot against one already-loaded page (no
    // reload between shots — see the README), and `expandedChartLayerId` is local `Experience`
    // state a "Humans" re-click doesn't reset, so a later shot in the same run can find the
    // chart already open. Matches either half of the sparkline button's own toggling
    // aria-label ("Expand ..."/"Collapse ..."), scoped exactly (the chart's own "Close ..."
    // button also ends in "Global population chart" and would otherwise collide), and only
    // clicks if it isn't already pressed.
    actions: async ({ page }) => {
      await page.getByRole('button', { name: 'Humans — the Holocene' }).click()
      const chartToggle = page.getByRole('button', { name: /^(Expand|Collapse) Global population chart$/ })
      if ((await chartToggle.getAttribute('aria-pressed')) !== 'true') await chartToggle.click()
    },
    measure: async ({ page }) => {
      const curve = await polylineTraceBounds(page, '[data-testid="layer-chart-svg"]')
      const text = (await page.textContent('[data-testid="layer-chart"]')) ?? ''
      return {
        curveWidth: curve.width,
        curveHeight: curve.height,
        showsBillion: text.includes('billion') ? 1 : 0,
        showsLogScale: text.includes('log scale') ? 1 : 0,
      }
    },
    expect: {
      // The chart's `<svg>` is stretched non-uniformly to the panel's own CSS width (not its
      // 600-unit viewBox — see `LayerChart.tsx`'s own comment on `preserveAspectRatio="none"`),
      // so at this viewport that's most of 1440px minus the shell's side padding. The bounding
      // box's height is dominated by the always-present vertical playhead line (it spans the
      // full plot regardless of the curve's shape), so it isn't itself proof of the log axis —
      // that's `chartAxis.test.ts`/`charts.test.tsx`'s job; here it only rules out a totally
      // blank plot.
      curveWidth: [1000, 1440],
      curveHeight: [60, 110],
      showsBillion: [1, 1],
      showsLogScale: [1, 1],
    },
  },
  {
    name: 'population-chart-mid-holocene',
    description:
      'Same chart, t=2025 (~0 CE, ~232 million people, DECISIONS.md/fixtures.ts\'s own sanity-check point) — the ' +
      'playhead should sit mid-curve, not pinned to either edge, proving scrubbing tracks the chart the way it ' +
      "already does for CO2's.",
    viewport: DEFAULT_VIEWPORT,
    t: 2025,
    // Idempotent by design: this harness runs every shot against one already-loaded page (no
    // reload between shots — see the README), and `expandedChartLayerId` is local `Experience`
    // state a "Humans" re-click doesn't reset, so a later shot in the same run can find the
    // chart already open. Matches either half of the sparkline button's own toggling
    // aria-label ("Expand ..."/"Collapse ..."), scoped exactly (the chart's own "Close ..."
    // button also ends in "Global population chart" and would otherwise collide), and only
    // clicks if it isn't already pressed.
    actions: async ({ page }) => {
      await page.getByRole('button', { name: 'Humans — the Holocene' }).click()
      const chartToggle = page.getByRole('button', { name: /^(Expand|Collapse) Global population chart$/ })
      if ((await chartToggle.getAttribute('aria-pressed')) !== 'true') await chartToggle.click()
    },
    measure: async ({ page }) => {
      const curve = await polylineTraceBounds(page, '[data-testid="layer-chart-svg"]')
      const text = (await page.textContent('[data-testid="layer-chart"]')) ?? ''
      return {
        curveWidth: curve.width,
        curveHeight: curve.height,
        showsMillion: text.includes('million') ? 1 : 0,
      }
    },
    expect: {
      curveWidth: [1000, 1440],
      curveHeight: [60, 110],
      showsMillion: [1, 1],
    },
  },
  {
    name: 'population-chart-early-holocene',
    description:
      "Same chart, t=11,700 (the Holocene's own cited base — early farming, near population's oldest well-covered " +
      "records) — the curve's left end, proving the domain is drawn all the way to its own old edge instead of " +
      'clipping early, and that the log axis keeps this era legible rather than flattened against the present-day ' +
      'spike a linear axis would produce.',
    viewport: DEFAULT_VIEWPORT,
    t: 11_700,
    // Idempotent by design: this harness runs every shot against one already-loaded page (no
    // reload between shots — see the README), and `expandedChartLayerId` is local `Experience`
    // state a "Humans" re-click doesn't reset, so a later shot in the same run can find the
    // chart already open. Matches either half of the sparkline button's own toggling
    // aria-label ("Expand ..."/"Collapse ..."), scoped exactly (the chart's own "Close ..."
    // button also ends in "Global population chart" and would otherwise collide), and only
    // clicks if it isn't already pressed.
    actions: async ({ page }) => {
      await page.getByRole('button', { name: 'Humans — the Holocene' }).click()
      const chartToggle = page.getByRole('button', { name: /^(Expand|Collapse) Global population chart$/ })
      if ((await chartToggle.getAttribute('aria-pressed')) !== 'true') await chartToggle.click()
    },
    measure: async ({ page }) => {
      const curve = await polylineTraceBounds(page, '[data-testid="layer-chart-svg"]')
      const text = (await page.textContent('[data-testid="layer-chart"]')) ?? ''
      return {
        curveWidth: curve.width,
        curveHeight: curve.height,
        showsMillion: text.includes('million') ? 1 : 0,
      }
    },
    expect: {
      curveWidth: [1000, 1440],
      curveHeight: [60, 110],
      showsMillion: [1, 1],
    },
  },
  // `co2-chart-log-axis-regression` (log axis for a wide-ratio scalar chart) removed 2026-09-18:
  // CO2 left the HUD entirely (`@/layers/hudVisibility.ts`, "still remove co2 section so thers
  // more room for events list"), so its `HudSparkline` toggle — the only way this chart ever
  // opened — no longer exists; the chart itself is unreachable, not merely unshown. Checked
  // first whether this was the log-axis behaviour's only coverage before dropping it: it is not
  // — `axisTransform`'s own unit tests (`src/layers/chartAxis.test.ts`) cover the ratio-threshold
  // math directly, including a population-scale (~1,600x) ratio well past CO2's own (~42x), and
  // the `population-chart` shot just above already asserts `showsLogScale: [1, 1]` end-to-end on
  // a real, still-reachable chart. This shot's only claim not duplicated elsewhere — that CO2's
  // declared ADR-027 gap "still breaks the line rather than bridging it" — was never actually
  // asserted in its own `expect` block despite the description; there is nothing here to repoint.
  {
    name: 'arrival-arc-mid-journey',
    description:
      "Migration-arc progressive reveal (user ask, 2026-09-18: \"showing journey from origin to destination\") — " +
      "mid-travel on the Out-of-Africa dispersal (out-of-africa-migration: established 60 ka, window to 70 ka), " +
      "sampled at t=65 ka, map mode so the arc's own screen position never depends on the sphere's (reduced-motion-" +
      "frozen) auto-rotate angle. HYDE density and the cities layer are both empty this far back (density eases in " +
      "only from ~14.5 ka), so toggling the whole human-civilisation layer off and back on in `measure` isolates the " +
      "arc/arrowhead/destination-ring specifically, not a density or city difference riding along with it.",
    viewport: DEFAULT_VIEWPORT,
    t: 65_000,
    state: { globeExpanded: true, globeViewMode: 'map', layerToggles: { 'human-civilisation': true } },
    measure: async ({ page, hook }) => {
      const { diffPixels, diffFraction } = await drawnPixelDiff(page, GLOBE_CANVAS_SELECTOR, async () => {
        await hook.setLayerToggle('human-civilisation', false)
        await rafTicks(page, 2)
      })
      await hook.setLayerToggle('human-civilisation', true)
      await rafTicks(page, 2)
      return { diffPixels, diffFraction }
    },
    expect: {
      // A revealed ribbon plus its arrowhead is a thin sliver of the whole map, but a real one —
      // this floor is well above screenshot/PNG round-trip noise (`countDiffPixels`'s own
      // threshold already filters that) and was set from this shot's own measured count.
      diffPixels: [80, 200_000],
    },
  },
  {
    name: 'arrival-arc-fades-by-present',
    description:
      'BUG (2026-09-18 user report: "the more modern migration paths are persisting on the globe up until present ' +
      'moment and not fading/disappearing") — confirmed root cause: `arrivalPresentationAt`\'s tail-fade width was ' +
      'never squeezed to fit the warp actually left between `established` and t=0, so a recently-established arc ' +
      "sat partly lit forever. Fixed by giving the tail the same squeeze the \"inhabited\" marker's own envelope " +
      "already used. This shot targets the most recent curated arrival (mass-european-emigration, established 175 " +
      'yr BP) — the worst case, with almost no warp left to fade across. The saved screenshot is t=0 itself: by eye, ' +
      "no amber arc is on screen anywhere (compare the sibling debug capture at t=established, where the Ireland-to-" +
      "New-York and the Britain-to-Australia arcs both stand fully drawn) — that visual absence is this shot's real " +
      "assertion. `measure`'s own diffPixels number is a much weaker, honestly-caveated signal, not a substitute: " +
      "it diffs t=established (arc undeniably lit) against t=0, but population density genuinely grew enormously " +
      "over exactly this 175-year span (~1.2B to ~7.3B people) — HYDE's own texture differs hugely between the two " +
      "frames regardless of the arc, so a healthy diffPixels count here does NOT by itself prove the arc faded; it " +
      "mainly floors out a total-rendering-failure regression (a blank/frozen canvas). The arc's own contribution " +
      "was confirmed the only way available without new instrumentation to isolate arc-coloured pixels from " +
      'density-coloured ones on this map: a human read of the screenshots (this file\'s own `description`, ' +
      'satisfying CLAUDE.md\'s "read your own screenshots and judge them").',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map', layerToggles: { 'human-civilisation': true } },
    measure: async ({ page, hook }) => {
      const { diffPixels, diffFraction } = await drawnPixelDiff(page, GLOBE_CANVAS_SELECTOR, async () => {
        await hook.setT(175)
        await hook.ready()
        await rafTicks(page, 2)
      })
      await hook.setT(0)
      await hook.ready()
      await rafTicks(page, 2)
      return { diffPixels, diffFraction }
    },
    expect: {
      // A floor against a total-rendering-failure regression only (see the description above for
      // why this can't be a precise arc-only signal) — set well below this shot's own measured
      // count.
      diffPixels: [80, 500_000],
    },
  },
  {
    name: 'population-sparkline-legible',
    description:
      'REOPENED (2026-09-18, coordinator re-review): the always-on HUD sparkline beneath "Global population" — ' +
      'the thing the user actually asked to copy from CO2, not the click-to-expand chart — measured as barely a ' +
      'dot. Root cause (confirmed against real DOM/polyline data, not just the chart-open shots below): both ' +
      "sparklines share one `FULL_DOMAIN_SYMLOG_SCALE` (4.6 Gyr) as the literal x-axis, and population's own " +
      '12,015-year domain is under 6% of that span — of 97 evenly spaced full-domain samples only ~5 landed ' +
      "inside it, all older than 1450 BP, so the entire industrial-era-to-present explosion (the whole shape) " +
      "fell between two samples and was never drawn. Fixed in `Sparkline.tsx` by windowing its own sampling to " +
      "`layer.timeDomain` instead of the passed scale's domain (still using that scale's `kind` — symlog). " +
      "UPDATED 2026-09-18 (CO2 hidden from the HUD, `@/layers/hudVisibility.ts`): this shot originally compared " +
      "population's drawn trace against CO2's own as the \"legible, like CO2's\" reference bar, and checked the " +
      "two readout rows never overlapped. CO2's readout no longer renders at all, so there is no other HUD " +
      "readout left to compare against or collide with — `hudScalarEntries` now has exactly one chartable entry. " +
      "Rather than fake a comparison against a row that no longer exists, this now asserts population's trace " +
      "against the same absolute pixel band directly (unchanged from the original popWidth/popHeight bounds, " +
      "which were never actually derived from a live co2Width/co2Height reading — see the removed measurement), " +
      "plus that CO2's own readout is genuinely gone and population's is the one that remains.",
    viewport: DEFAULT_VIEWPORT,
    t: 10,
    measure: async ({ page }) => {
      // `polylineTraceBounds`, not `drawnBounds`: both sparklines sit directly over the scene
      // photo with no opaque backing, and `drawnBounds`' own corner-sampled background check is
      // fooled by that photo's texture alone (see that helper's own doc comment) — a real risk
      // this exact shot could otherwise have papered over.
      const pop = await polylineTraceBounds(page, '[data-testid="scalar-readout-population"] svg')
      const popValue = await page
        .locator('[data-testid="scalar-readout-population"] [data-testid="scalar-readout-value"]')
        .boundingBox()
      const co2ReadoutCount = await page.locator('[data-testid="scalar-readout-co2"]').count()
      const popReadoutCount = await page.locator('[data-testid="scalar-readout-population"]').count()
      return {
        popWidth: pop.width,
        popHeight: pop.height,
        // The sparkline's own drawn top sits below the population value text's own bottom —
        // "beneath the current count".
        popBelowOwnValue: popValue && pop.y >= popValue.y + popValue.height - 1 ? 1 : 0,
        co2ReadoutCount,
        popReadoutCount,
      }
    },
    expect: {
      popWidth: [120, 200],
      popHeight: [15, 32],
      popBelowOwnValue: [1, 1],
      co2ReadoutCount: [0, 0],
      popReadoutCount: [1, 1],
    },
  },
  {
    name: 'feed-gets-space-co2-vacated',
    description:
      'The actual goal of hiding CO2 from the HUD (user: "still remove co2 section so thers more room for events ' +
      'list") was never "delete a row" for its own sake — it was to give `<EventFeed>` more room. `.readouts` and ' +
      "`.feed` share one column as consecutive grid rows (`ShellLayout.module.css`'s `.hud` grid: `.readouts` is " +
      "an `auto` track sized to its own content, `.feed` is the one `minmax(0, 1fr)` track that absorbs whatever " +
      "height the `auto` tracks don't need) — removing CO2's row shrinks `.readouts`, and this shot proves that " +
      "shrink actually reaches `.feed` rather than becoming dead space, by asserting `.feed`'s own box (`boxOf`, " +
      "a deliberate layout measurement — see `SHELL_FEED_SELECTOR`'s own doc comment for why a drawn-pixel " +
      'measurement is the wrong tool here) grew by real, measured amounts. At this viewport (1440x900, t=10): ' +
      'BEFORE (both co2 and population readout rows present) `.readouts` was 190.4px / `.feed` was 95.1px; AFTER ' +
      '(co2 hidden, population only) `.readouts` is 79.9px / `.feed` is 205.6px — CO2\'s vacated row (~110px) ' +
      "reached `.feed` in full, more than doubling its usable height, not merely shrinking `.readouts` and " +
      'leaving the difference as dead space. Both numbers are asserted against the current (fixed) build\'s own ' +
      'bands below; confirmed against the unfixed build (co2 still shown) that they read 190.4/95.1 and fail.',
    viewport: DEFAULT_VIEWPORT,
    t: 10,
    measure: async ({ page }) => {
      const readouts = await boxOf(page, SHELL_READOUTS_SELECTOR)
      const feed = await boxOf(page, SHELL_FEED_SELECTOR)
      return { readoutsHeight: readouts.height, feedHeight: feed.height }
    },
    expect: {
      // `.readouts` now holds just the population row (co2's own row is gone) — measured 79.9px,
      // versus 190.4px with both rows present (confirmed by temporarily un-hiding co2 and
      // re-running this shot, which fails both bands below as expected).
      readoutsHeight: [60, 110],
      // Measured 205.6px with co2 hidden, versus 95.1px with it shown — a real, order-of-110px
      // gain reaching `.feed`, not dead space left behind in `.readouts`'s old row.
      feedHeight: [180, 240],
    },
  },
  {
    name: 'event-feed-card-count-stable-across-captions',
    description:
      'The event feed\'s visible card count must depend only on the viewport, never on which scene\'s caption ' +
      'happens to be showing: `amsterdam-voc-harbour` (t=375) carries one of the longest real captions (~350 ' +
      'characters, several wrapped lines) and `columbus-landfall-1492` (t=533) one of the shortest — both fall in ' +
      "the same event-dense stretch of the Holocene, so the feed's own candidate pool is comparable either way. " +
      "`ShellLayout.module.css`'s `.caption` now caps its own height (`max-height` + `overflow-y: auto`), so a " +
      "longer caption no longer eats into `.feed`'s track below it.",
    viewport: DEFAULT_VIEWPORT,
    t: 533,
    measure: async ({ page, hook }) => {
      await hook.ready()
      const shortCaptionCount = await page.locator(EVENT_FEED_ITEM_SELECTOR).count()
      await hook.setT(375)
      await hook.ready()
      const longCaptionCount = await page.locator(EVENT_FEED_ITEM_SELECTOR).count()
      return { shortCaptionCount, longCaptionCount, countsMatch: shortCaptionCount === longCaptionCount ? 1 : 0 }
    },
    // Both counts must be equal, and (at this viewport, plenty of vertical room) more than one —
    // a shot that only ever showed a single card either way would not distinguish "the fix works"
    // from "there was never more than one card available regardless".
    expect: { countsMatch: [1, 1], shortCaptionCount: [2, 4], longCaptionCount: [2, 4] },
  },
  {
    name: 'event-feed-card-count-stable-across-captions-tall',
    description: 'Same as `event-feed-card-count-stable-across-captions`, at a taller viewport with more vertical room to show cards in.',
    viewport: { width: 1440, height: 1200 },
    t: 533,
    measure: async ({ page, hook }) => {
      await hook.ready()
      const shortCaptionCount = await page.locator(EVENT_FEED_ITEM_SELECTOR).count()
      await hook.setT(375)
      await hook.ready()
      const longCaptionCount = await page.locator(EVENT_FEED_ITEM_SELECTOR).count()
      return { shortCaptionCount, longCaptionCount, countsMatch: shortCaptionCount === longCaptionCount ? 1 : 0 }
    },
    expect: { countsMatch: [1, 1] },
  },
  {
    name: 'event-feed-no-overflow-at-1280x720',
    description:
      "A short, wide desktop window (1280x720, `.feed`'s own ShellLayout.module.css comment names this the worst " +
      "case measured) leaves `.feed`'s track very little spare height once the title, readouts and bottom bands " +
      "take theirs — this checks the feed's own box never grows past the bottom of its column and overlaps the " +
      "scene caption/timeline below it, even with the long-caption scene from the stability shots above.",
    viewport: { width: 1280, height: 720 },
    t: 375,
    measure: async ({ page }) => {
      const feed = await boxOf(page, SHELL_FEED_SELECTOR)
      const bottom = await boxOf(page, BOTTOM_CHROME_SELECTOR)
      return { overlapsBottom: rectsOverlap(feed, bottom) ? 1 : 0 }
    },
    expect: { overlapsBottom: [0, 0] },
  },
  {
    name: 'event-feed-card-position-stable-across-t',
    description:
      "A card's drawn position must depend only on its rank in the feed, never on `t` itself: `distanceFraction` " +
      'moves continuously as `t` scrubs even while the visible set is unchanged, and the old per-card ' +
      '`translateY(feedCardOffsetPx(distanceFraction))` chased that every frame, reading as constant jitter. ' +
      'Both `t=250` and `t=290` resolve to the identical three-event set (`transatlantic-slave-trade`, ' +
      '`newcomen-steam-engine`, `newton-principia`, same order) — verified against both the fixed selection rule ' +
      "(age-ratio only) and the removed pixel-lookback one it replaces, so this isolates the drift fix from the " +
      "selection-rule change. Confirmed failing against the unfixed build: yDelta measured ~1.96px there.",
    viewport: DEFAULT_VIEWPORT,
    // This shot's whole point is a per-card `transform` that used to change with `t` — running
    // under real motion (rather than the run's own `reduce` default) keeps the guard meaningful
    // against a regression that reintroduces one.
    reducedMotion: 'no-preference',
    t: 250,
    measure: async ({ page, hook }) => {
      const freshestSelector = '[data-testid="event-feed-item-transatlantic-slave-trade"]'
      const idsAt = () => page.locator(EVENT_FEED_ITEM_SELECTOR).evaluateAll((els) => els.map((el) => el.dataset.testid))
      const idsT1 = await idsAt()
      const boxT1 = await boxOf(page, freshestSelector)
      await hook.setT(290)
      // `.card`'s own opacity transition (EventFeed.module.css) has no readiness signal of its
      // own — `hook.ready()` only covers network/decode state — so this settles any CSS
      // transition before measuring, the same reasoning `timeouts.mjs`'s two waits give.
      await page.waitForTimeout(300)
      const idsT2 = await idsAt()
      const boxT2 = await boxOf(page, freshestSelector)
      return {
        sameVisibleSet: idsT1.length === idsT2.length && idsT1.every((id, i) => id === idsT2[i]) ? 1 : 0,
        yDelta: Math.abs(boxT1.y - boxT2.y),
      }
    },
    expect: { sameVisibleSet: [1, 1], yDelta: [0, 0.5] },
  },
  {
    name: 'breadcrumb-trimmed',
    description:
      'Chrome-rearrange pass (user ask, 2026-09-18): the breadcrumb\'s own "‹ Up"/"⌂ Earth" buttons are deleted ' +
      'outright (the parent is always one click away as its own crumb; the root crumb beside "⌂" was already always ' +
      'labelled "Earth"), leaving only the ancestor trail. Navigates two levels deep (Cenozoic, then Quaternary) so ' +
      'the trail actually holds clickable ancestor crumbs, and asserts every button inside the breadcrumb `<nav>` is ' +
      'one of those crumbs — none of the four shortcut buttons this used to carry.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    actions: async ({ page }) => {
      await page.getByRole('button', { name: /^Cenozoic,/ }).click()
      await page.getByRole('button', { name: /^Quaternary,/ }).click()
    },
    measure: async ({ page }) => {
      const crumbLabels = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Timeline section"]')
        return nav ? Array.from(nav.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')) : null
      })
      return {
        breadcrumbCurrent: (await page.textContent(BREADCRUMB_CURRENT_SELECTOR))?.trim() ?? null,
        // Exactly the ancestor crumbs (Earth, Cenozoic) — no "Already at the top level"/"Back to
        // Earth"/"Previous section: …"/"Next section: …" among them.
        crumbCount: crumbLabels?.length ?? -1,
        hasUpOrHomeOrSiblingButton:
          crumbLabels?.some((l) => l !== null && /Up to |Back to Earth|Already |Previous section|Next section/.test(l))
            ? 1
            : 0,
      }
    },
    expect: {
      crumbCount: [2, 2],
      hasUpOrHomeOrSiblingButton: [0, 0],
    },
  },
  {
    name: 'section-edge-nav-enabled',
    description:
      'The previous/next sibling-section buttons moved off the breadcrumb onto the scrub track itself (user ask, ' +
      '2026-09-18: "the next/previous sibling era navigation buttons should be moved to the far left and right edges ' +
      'of the era range on the timeline"). Navigates to the Jurassic (Dinosaurs shortcut, then the Jurassic band), ' +
      'which has both a previous (Triassic) and next (Cretaceous) sibling directly, and: (1) the two buttons carry ' +
      'the same aria-label/title text — naming the real destination and its keyboard shortcut — the breadcrumb ' +
      'buttons used to; (2) neither button\'s CSS box overlaps the scrub track\'s own hit area (`role="slider"`), so ' +
      'they can never intercept a drag meant for the track; (3) a REAL pointer drag (mouse down/move/up, not a ' +
      'synthetic click) past either literal edge of the (now narrower) track still lands `t` on that edge — proof ' +
      "the edge buttons cost the track no reachable range; (4) clicking \"Previous section: Triassic\" actually " +
      'selects the Triassic section, through the same `onSelectSection` every other section control uses.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    actions: async ({ page }) => {
      await page.getByRole('button', { name: /^Dinosaurs — /, exact: false }).click()
      await page.getByRole('button', { name: /^Jurassic,/ }).click()
    },
    measure: async ({ page, hook }) => {
      const previous = page.getByRole('button', { name: /^Previous section:/ })
      const next = page.getByRole('button', { name: /^Next section:/ })
      const [previousLabel, previousTitle, nextLabel, nextTitle] = await Promise.all([
        previous.getAttribute('aria-label'),
        previous.getAttribute('title'),
        next.getAttribute('aria-label'),
        next.getAttribute('title'),
      ])
      const [previousBox, nextBox, trackBox] = await Promise.all([
        previous.boundingBox(),
        next.boundingBox(),
        page.getByRole('slider', { name: 'Scrub timeline' }).boundingBox(),
      ])
      const noOverlap = (a, b) => a !== null && b !== null && (a.x + a.width <= b.x || b.x + b.width <= a.x)

      // A real drag past the track's own right edge — the newest (present-ward) end — must clamp
      // `t` to the section's own newest boundary, not stop short of it or land on a button instead.
      const rightEdgeT = await (async () => {
        const box = trackBox
        const y = box.y + box.height / 2
        await page.mouse.move(box.x + box.width / 2, y)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width + 20, y, { steps: 8 })
        await page.mouse.up()
        return (await hook.getState())?.t ?? null
      })()
      const leftEdgeT = await (async () => {
        const box = trackBox
        const y = box.y + box.height / 2
        await page.mouse.move(box.x + box.width / 2, y)
        await page.mouse.down()
        await page.mouse.move(box.x - 20, y, { steps: 8 })
        await page.mouse.up()
        return (await hook.getState())?.t ?? null
      })()

      const beforeClick = await hook.getState()
      await previous.click()
      const afterClick = await hook.getState()

      return {
        previousLabel,
        previousTitle,
        nextLabel,
        nextTitle,
        previousOverlapsTrack: noOverlap(previousBox, trackBox) ? 0 : 1,
        nextOverlapsTrack: noOverlap(nextBox, trackBox) ? 0 : 1,
        rightEdgeT,
        leftEdgeT,
        wasJurassic: beforeClick?.sectionId === 'jurassic' ? 1 : 0,
        selectedTriassic: afterClick?.sectionId === 'triassic' ? 1 : 0,
      }
    },
    expect: {
      previousOverlapsTrack: [0, 0],
      nextOverlapsTrack: [0, 0],
      // Jurassic: [143.1 Ma, 201.4 Ma] (sections.ts) — the right/newest edge clamps to 143.1 Ma,
      // the left/oldest edge to 201.4 Ma, each within a small tolerance of the fisheye-distorted
      // pixel grid rather than exact float equality.
      rightEdgeT: [143_050_000, 143_150_000],
      leftEdgeT: [201_350_000, 201_450_000],
      wasJurassic: [1, 1],
      selectedTriassic: [1, 1],
    },
  },
  {
    name: 'section-edge-nav-disabled-at-root',
    description:
      'At the root section (Earth, the full domain) neither sibling-section move has anywhere to go — both edge-nav ' +
      'buttons stay in place, `disabled`, rather than disappearing (so the track\'s own drawn width never jumps as ' +
      'the section changes), matching the convention the breadcrumb\'s own now-deleted "‹ Up"/"⌂ Earth" buttons used.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    actions: async ({ page }) => {
      await page.getByRole('button', { name: /^Earth — /, exact: false }).click()
    },
    measure: async ({ page }) => {
      const previous = page.getByRole('button', { name: 'No previous section' })
      const next = page.getByRole('button', { name: 'No next section' })
      return {
        previousDisabled: (await previous.isDisabled()) ? 1 : 0,
        nextDisabled: (await next.isDisabled()) ? 1 : 0,
        previousVisible: (await previous.isVisible()) ? 1 : 0,
        nextVisible: (await next.isVisible()) ? 1 : 0,
      }
    },
    expect: {
      previousDisabled: [1, 1],
      nextDisabled: [1, 1],
      // Kept in place, not hidden — a disabled button is still visible.
      previousVisible: [1, 1],
      nextVisible: [1, 1],
    },
  },
  {
    name: 'population-sparkline-no-data-state',
    description:
      'REOPENED again (2026-09-18, coordinator follow-up): user screenshot at an early `t` showed both readouts ' +
      'reading "no data" while their sparklines were nevertheless drawn complete — the whole future, arrival-arc- ' +
      'and city-marker-inconsistent. t=20,000 sits older than population\'s own oldest domain edge (12,025) — ' +
      "nothing has happened yet. Asserts the sparkline's DRAWN trace (not its SVG box, which is always full-width " +
      'regardless) is empty: no polyline, no dot — only the bare "you are here" playhead line, same as the ' +
      "timeline's own always-visible playhead.",
    viewport: DEFAULT_VIEWPORT,
    t: 20_000,
    measure: async ({ page }) => {
      // `polylineTraceBounds`, not `drawnBounds` — see that helper's own doc comment: this
      // sparkline sits directly over the scene photo with no opaque backing, so pixel-diffing
      // against a sampled-corner background is fooled by the photo's own texture alone.
      const trace = await polylineTraceBounds(page, '[data-testid="scalar-readout-population"] svg')
      const readsNoData = ((await page.textContent('[data-testid="scalar-readout-population"]')) ?? '').includes('no data')
      return { traceWidth: trace.width, traceHeight: trace.height, readsNoData: readsNoData ? 1 : 0 }
    },
    expect: {
      // A few px of tolerance for the always-drawn vertical playhead line itself (pinned to the
      // domain's near edge here — see Sparkline.tsx) — never a real trace width.
      traceWidth: [0, 3],
      readsNoData: [1, 1],
    },
  },
  {
    name: 'population-sparkline-grows-with-t',
    description:
      'The definite, primary fix (user verbatim: "my idea for the population and co2 graph lines was for them to ' +
      'grow over time, not be fully visible upfront"): sweeps `t` from before population\'s own domain through to ' +
      "its newest edge and measures the sparkline's DRAWN trace width at each stop (never the SVG box, which is " +
      'full-width throughout and would prove nothing). Asserts the width is zero with nothing yet reached, then ' +
      'strictly increases at each later stop — this specific monotonic-growth assertion is the one the coordinator ' +
      'asked to fail against the pre-fix build, where the full trace is drawn at every `t` and every stop would ' +
      'read the same, already-maximal width.',
    viewport: DEFAULT_VIEWPORT,
    t: 20_000,
    measure: async ({ page, hook }) => {
      const widthAt = async (t) => {
        await hook.setT(t)
        await hook.ready()
        await rafTicks(page, 2)
        const trace = await polylineTraceBounds(page, '[data-testid="scalar-readout-population"] svg')
        return trace.width
      }
      // Before the domain begins; deep in it; mid-domain; near its own newest edge. 8,000 (not
      // right at the domain's own oldest edge, 12,025) is deliberate: population's adaptive
      // symlog knee (~12 yr) packs the 97-sample grid so tightly near that edge that anything
      // closer only has the bare minimum two reached points needed to draw a segment at all —
      // real, but a sub-pixel sliver next to nothing, not a meaningfully assertable width.
      const beforeDomain = await widthAt(20_000)
      const early = await widthAt(8_000)
      const mid = await widthAt(5_000)
      const late = await widthAt(10)
      return {
        beforeDomain,
        early,
        mid,
        late,
        earlyGrowth: early - beforeDomain,
        midGrowth: mid - early,
        lateGrowth: late - mid,
      }
    },
    expect: {
      beforeDomain: [0, 3],
      // Each step must be a real, visible increase, not noise — well above antialiasing slop.
      earlyGrowth: [5, 200],
      midGrowth: [5, 200],
      lateGrowth: [5, 200],
      // The fully-grown trace should reach close to the row's own full width (matches
      // `population-sparkline-legible`'s own popWidth band).
      late: [120, 200],
    },
  },
  // `co2-sparkline-grows-with-t` removed 2026-09-18: its subject, CO2's own HUD sparkline, no
  // longer exists (`@/layers/hudVisibility.ts` — CO2 is hidden from the HUD entirely). The
  // sibling shot immediately above, `population-sparkline-grows-with-t`, still covers the same
  // growth-reveal mechanism on the one HUD scalar sparkline that remains.
  {
    name: 'population-chart-ghost-future',
    description:
      'The expanded `LayerChart` gets a different treatment than the sparkline (2026-09-18, coordinator: "do NOT ' +
      'simply hide the future there... a chart opened deliberately to inspect the data is a different contract"): ' +
      'the reached portion draws at full weight, the not-yet-reached remainder draws as a faint, fill-less ghost ' +
      "line (`chartLineGhost`) rather than being hidden outright, so the axis stays put and the chart stays " +
      "readable at an early `t`. Opens population's chart under the \"Humans\" section (as the other population-" +
      'chart-* shots do, so the x-axis actually covers its domain) at t=5,000 — roughly the midpoint — and asserts ' +
      'both a full-weight and a ghost polyline are present.',
    viewport: DEFAULT_VIEWPORT,
    t: 5_000,
    actions: async ({ page }) => {
      await page.getByRole('button', { name: 'Humans — the Holocene' }).click()
      const chartToggle = page.getByRole('button', { name: /^(Expand|Collapse) Global population chart$/ })
      if ((await chartToggle.getAttribute('aria-pressed')) !== 'true') await chartToggle.click()
    },
    measure: async ({ page }) => {
      const solid = await page.locator('[data-testid="layer-chart-svg"] polyline:not([class*="Ghost"])').count()
      const ghost = await page.locator('[data-testid="layer-chart-svg"] polyline[class*="Ghost"]').count()
      return { solid, ghost }
    },
    expect: {
      solid: [1, 10],
      ghost: [1, 10],
    },
  },
  {
    name: 'timeline-pip-thumbnail-hover',
    description:
      'Hovering a timeline checkpoint pip must still show a crisp, correctly-framed circular preview backed by ' +
      "its own dedicated thumbnail (`Scene.thumbnail`, `pipeline.transcode.THUMBNAIL_SIZE`-square) -- never the " +
      'full-resolution scene still (`Scene.image`) the pip used to fetch unconditionally on every page load ' +
      "regardless of hover (the bug `Experience.tsx`'s `thumbnailUrl` and this thumbnail field both fix). " +
      "`.pipThumb` is a 44 CSS-px circle (`ScrubTrack.module.css`); reduced motion (this harness's default) " +
      "makes `.pipPreview`'s opacity transition instant, so a plain hover is enough -- no transition wait needed.",
    viewport: DEFAULT_VIEWPORT,
    actions: async ({ page }) => {
      await page.locator(CHECKPOINT_PIP_SELECTOR).first().hover()
    },
    measure: async ({ page }) => ({
      thumb: await drawnBounds(page, `${CHECKPOINT_PIP_SELECTOR} img`),
    }),
    expect: {
      'thumb.width': [38, 48],
      'thumb.height': [38, 48],
    },
  },
  {
    // West Turkana, Kenya (`acheulean-erectus`, t = 1.76 Ma): inside the human-era basemap
    // domain (so the marker renders against real geography) but centuries before any arrival
    // arc/city/population-density data exists, so the "Human civilisation" layer draws *only*
    // the scene marker at this `t` — nothing else in `HumanCivilisation.tsx`'s own marker list
    // can be mistaken for it by `scanForSceneMarkerColor`.
    name: 'globe-scene-focus-centred',
    description:
      'ADR-034 centring, baseline case (docs/GLOBE.md, user report: "the automatic movement of the globe to ' +
      'position of the current scene location... moves but doesn\'t actually go all the way to centre the ' +
      'view"). No prior drag: the camera sits at its default azimuth (0) when West Turkana becomes the ' +
      "dominant scene, so even the pre-fix formula (`focusRotationY(lon)`, assuming azimuth 0) landed here " +
      'correctly — this shot is the control proving the fix did not regress the already-working case, measured ' +
      'the same way (`globeOrbMarkerOffsetDeg`, colour-matching the marker against the drawn sphere\'s own ' +
      'centre) as the two shots below that exercise the actual bugs.',
    viewport: DEFAULT_VIEWPORT,
    reducedMotion: 'reduce',
    // No shot-level `t`, so this doesn't silently depend on running first (or on whatever `t`
    // an earlier shot in the full suite happened to leave behind) for the "camera is at its
    // default azimuth" premise the description above relies on — see the other two shots' own
    // comments on why re-setting an unchanged `t` never starts a fresh ease at all. Parking on
    // the no-location `archean-shore` frame first, with no drag in between, guarantees a clean
    // null -> lon transition with the camera genuinely still at its own default azimuth.
    actions: async ({ page, hook }) => {
      await hook.setT(3.45e9)
      await waitForSceneCrossfadeSettle(page)
      await hook.setT(1.76e6)
      await waitForSceneCrossfadeSettle(page)
    },
    measure: async ({ page }) => {
      const result = await globeOrbMarkerOffsetDeg(page)
      return { offsetDeg: result?.offsetDeg ?? null, markerPixelCount: result?.markerPixelCount ?? 0 }
    },
    expect: {
      markerPixelCount: [4, 100000],
      offsetDeg: [-2, 2],
    },
  },
  {
    name: 'globe-scene-focus-after-drag',
    description:
      'ADR-034 centring, hypothesis 1 (this brief\'s own diagnosis): "the camera azimuth is unaccounted for" — ' +
      '`OrbitControls` rotates the camera on the minimised orb (`Globe.tsx`\'s own "OrbitControls now rotates ' +
      'in both states" note), so a viewer who dragged the orb before a scene\'s location becomes the focus ' +
      'target leaves the camera at some azimuth the old `focusRotationY(lon)` (which assumed azimuth 0) had no ' +
      'way to know about — landing the ease exactly that far short of centred. Drags the orb (`dragGlobeOrb`) ' +
      'while a scene with no location is current, *then* sets `t` to West Turkana so the (now camera-azimuth-' +
      'aware) ease target is computed against the already-rotated camera, matching the real "drag, then scrub ' +
      'onto a located scene" sequence the report describes. `reducedMotion: reduce` snaps the ease instantly ' +
      'rather than animating it — the landing formula is what this shot checks, not the tween.',
    viewport: DEFAULT_VIEWPORT,
    reducedMotion: 'reduce',
    // No shot-level `t`: this must force a genuine *new* focus target itself rather than lean on
    // whatever the previous shot already left `t` at, since re-setting `t` to a value the store
    // already holds is a no-op that would never trigger a fresh ease at all (the hook only starts
    // one when `focusLon` actually changes — `useGlobeAutoRotation.ts`'s own doc comment). First
    // parking on `archean-shore` (3.45 Ga, no `location` at all — too far back for any plate
    // model, ADR-034's own "no marker" rule) clears any prior focus target, so the drag below
    // happens with nothing eased and the subsequent jump to West Turkana is unambiguously the
    // transition that starts the ease this shot is measuring.
    actions: async ({ page, hook }) => {
      await hook.setT(3.45e9)
      await waitForSceneCrossfadeSettle(page)
      await dragGlobeOrb(page)
      // Lets `OrbitControls`' own damped inertia (`enableDamping={settled}`, on for the idle
      // orb) fully decay before the camera's azimuth is read: a drag released with real momentum
      // keeps the camera rotating for a stretch after `mouseup`, independent of and unsynced with
      // whatever ease starts next — reading too early captures a stale, still-moving azimuth and
      // reports an error the *fix* didn't cause (browser-verified: a 1s wait here still measured
      // ~2° at this drag distance; 2.5s converges to the exact same residual the no-drag baseline
      // shot measures, to 15 decimal digits — i.e. genuinely fully settled, not just "close").
      await page.waitForTimeout(2_500)
      await hook.setT(1.76e6)
      await waitForSceneCrossfadeSettle(page)
      await waitForFocusEaseSettle(page)
    },
    measure: async ({ page }) => {
      const result = await globeOrbMarkerOffsetDeg(page)
      return { offsetDeg: result?.offsetDeg ?? null, markerPixelCount: result?.markerPixelCount ?? 0 }
    },
    expect: {
      markerPixelCount: [4, 100000],
      offsetDeg: [-2, 2],
    },
  },
  {
    name: 'globe-scene-focus-holds-after-dwell',
    description:
      'ADR-034 centring, hypothesis 2 (this brief\'s own diagnosis): "drift pulls it back off after it lands" — ' +
      '`useGlobeAutoRotationY` used to resume `AUTO_ROTATE_RADIANS_PER_SECOND` drift the instant the focus ease ' +
      'finished, regardless of whether the located scene was still on screen, sliding the marker back off-centre ' +
      'over a scene\'s own dwell (~1.4 deg/s -> ~14 deg over a 10s dwell). The fix ties drift suppression to ' +
      '"is a scene location currently the target" rather than "is an ease currently running" (see that hook\'s ' +
      'own doc comment for why a fixed extra delay was rejected). `reducedMotion: no-preference` — unlike the ' +
      'two shots above, this one needs real animated drift to have something to (not) accumulate — waits for ' +
      'the ease to land and then a further 8s of simulated dwell before measuring, well past the ~1.2s ease ' +
      'itself.',
    viewport: DEFAULT_VIEWPORT,
    reducedMotion: 'no-preference',
    // No shot-level `t`, for the same reason `globe-scene-focus-after-drag` gives: re-setting `t`
    // to a value the store already holds would never start a fresh ease. Parking on the same
    // no-location `archean-shore` frame first guarantees the jump to West Turkana below is a real
    // null -> lon transition, so the ease this shot then waits out and measures after is one this
    // shot itself actually triggered, not a leftover from whichever shot happened to run first.
    actions: async ({ page, hook }) => {
      await hook.setT(3.45e9)
      await waitForSceneCrossfadeSettle(page)
      await hook.setT(1.76e6)
      await waitForSceneCrossfadeSettle(page)
      await waitForFocusEaseSettle(page)
      await page.waitForTimeout(8_000)
    },
    measure: async ({ page }) => {
      const result = await globeOrbMarkerOffsetDeg(page)
      return { offsetDeg: result?.offsetDeg ?? null, markerPixelCount: result?.markerPixelCount ?? 0 }
    },
    expect: {
      markerPixelCount: [4, 100000],
      offsetDeg: [-2, 2],
    },
  },
]
