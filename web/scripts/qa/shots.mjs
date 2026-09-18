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
import { drawnBounds, drawnBoundsInClip, hiddenBoxOf } from './measure.mjs'
import { waitForApproxUnfoldProgress, waitForFocusEaseSettle, waitForSceneCrossfadeSettle } from './timeouts.mjs'
import {
  BOTTOM_CHROME_SELECTOR,
  BREADCRUMB_CURRENT_SELECTOR,
  CHECKPOINT_PIP_SELECTOR,
  ERA_SHORTCUTS_SELECTOR,
  GLOBE_CANVAS_SELECTOR,
  GLOBE_MAP_FIT_FRAME_SELECTOR,
  GLOBE_SPHERE_FIT_FRAME_SELECTOR,
  SCENE_CANVAS_SELECTOR,
  SECTION_BANDS_SELECTOR,
} from './selectors.mjs'

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
    name: 'globe-expanded-sphere',
    description:
      'Expanded globe, sphere mode, measured at its own real DEFAULT diameter — guards against the CSS-box/drawn-' +
      'pixel mix-up that shrank the sphere to ~226px, and (2026-09-18, user report: "opens zoomed in a lot, need to ' +
      'press zoom out 6 times to get it back to reasonable original size") the camera-fit regression from the same ' +
      "day's \"remove the square zoom clip\" change: moving the expanded `<canvas>` to cover the whole backdrop " +
      "(`Globe.module.css`'s `.orbExpanded` doc comment) means `GlobeCameraControls` must fit the *default* view " +
      "against the measured `.orbFitFrameSphere` rectangle instead of the canvas's own now-viewport-sized one, and " +
      'two distinct bugs in getting that measurement right both briefly left the camera far too close — see that ' +
      "component's own `sphereFrameReady`/`isSubFrameOf` doc comments for the root causes. Clipped to the real fit-" +
      "frame rectangle (`GLOBE_SPHERE_FIT_FRAME_SELECTOR`'s own doc comment explains why `GLOBE_CANVAS_SELECTOR` " +
      'alone no longer isolates the sphere from the surrounding chrome) rather than measured at zoom-interaction ' +
      'time at all, so this is a true zero-interaction "does it open at the right size" check, not a proxy for it. ' +
      "`useChromeGap` fits this panel to the shell's actual live title-to-timeline gap, so anything that changes " +
      "the title's own height legitimately moves this band: ~528px before the 2026-09-18 bottom-chrome condensing " +
      'pass, ~592px after it, ~546px after the same-day Earth/Dinosaurs/Humans shortcut group added a row to the ' +
      'title, ~573-593px after the clip-removal architecture change (unaffected in itself — only the *room to zoom ' +
      'in* changed) folded with the "make the globe slightly larger by default" nudge (`SPHERE_DEFAULT_SCALE`).',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page }) => ({ sphere: await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR)) }),
    expect: { 'sphere.width': [555, 595], 'sphere.height': [555, 595] },
  },
  {
    name: 'globe-expanded-map',
    description:
      'Expanded globe, unrolled Equal Earth map mode, measured at its own real DEFAULT size — guards the map-mode ' +
      'fit-to-panel framing (ADR-033) the same way `globe-expanded-sphere` guards the sphere\'s (same clip-to-real-' +
      "fit-frame reasoning, against `GLOBE_MAP_FIT_FRAME_SELECTOR` — see that shot's own description for why " +
      "`GLOBE_CANVAS_SELECTOR` alone can no longer isolate the map from the surrounding chrome), and (2026-09-18, " +
      'user report: "when it\'s expanded to a map it still has the \'drag hand\' mouse icon... dragging doesn\'t do ' +
      'anything in this mode") that the default, fully-zoomed-out map cursor is *not* `grab`: `camera.ts`\'s ' +
      "`mapHasPanRoom` is false here (the fit distance's own margin already shows slightly more than the whole " +
      'map, so there is genuinely nowhere to pan to yet). Same title-height dependency as ' +
      "`globe-expanded-sphere`'s own: ~1082px before the 2026-09-18 bottom-chrome condensing pass, ~1213px after " +
      'it, ~1119px after the same-day Earth/Dinosaurs/Humans shortcut group grew the title by one row — unaffected ' +
      "by the sphere-only `SPHERE_DEFAULT_SCALE` nudge (`globe-expanded-sphere`'s own description).",
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'map' },
    measure: async ({ page }) => {
      const cursor = await page.locator(GLOBE_CANVAS_SELECTOR).first().evaluate((el) => getComputedStyle(el).cursor)
      const map = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_MAP_FIT_FRAME_SELECTOR))
      return { map, cursorIsNotGrab: cursor !== 'grab' ? 1 : 0 }
    },
    // ~1213px matches this shot's own description ("~1213px after [the 2026-09-18 bottom-chrome
    // condensing pass]") — now measured directly against the real fit frame instead of via the
    // full canvas, so this replaces the old [1090, 1150] band which was never actually re-derived
    // after that pass (this fit-frame clip is new; the old band predates it and drifted stale).
    expect: { 'map.width': [1195, 1230], cursorIsNotGrab: [1, 1] },
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
      'cut that starts clipping/overlapping rows — should fail this band. Measured 152px again ' +
      '(same-day chrome-rearrange pass, user ask: move the era shortcuts into this row, delete the ' +
      'breadcrumb\'s "‹ Up"/"⌂ Earth" buttons, move its "‹"/"›" onto the track edges) — folding a ' +
      'whole new control (`EraShortcuts`) into `.controlsSections` alongside deleting two others ' +
      "cost this band nothing: every row here is already sized by the 44px play button beside it.",
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
      'The Earth/Dinosaurs/Humans "jump to an era" shortcut group (user ask, 2026-09-18), Earth active by default at ' +
      't=0. Moved the same day, in a later chrome-rearrange pass (user ask: "move the earth/dinosaurs/humans era ' +
      'shortcuts down to the bottom above the timeline"), from a row of its own beside the shell title into ' +
      '`<Timeline>`\'s own `.controlsSections` — now INSIDE `BOTTOM_CHROME_SELECTOR`\'s own subtree (see ' +
      '`insideChrome`), folded into the horizontal room the breadcrumb gave up when its "‹ Up"/"⌂ Earth" buttons were ' +
      'deleted and its "‹"/"›" buttons moved onto the track edges — proof it is a genuine fold-in, not a row of its ' +
      "own, is that the bottom-chrome height guard still reads the same [135, 175] band `bottom-chrome-height` " +
      'already asserts.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    measure: async ({ page, hook }) => {
      const state = await hook.getState()
      const insideChrome = await page.evaluate(
        ([shortcutsSel, chromeSel]) => {
          const shortcuts = document.querySelector(shortcutsSel)
          const chrome = document.querySelector(chromeSel)
          return shortcuts !== null && chrome !== null && chrome.contains(shortcuts)
        },
        [ERA_SHORTCUTS_SELECTOR, BOTTOM_CHROME_SELECTOR],
      )
      return {
        shortcuts: await drawnBounds(page, ERA_SHORTCUTS_SELECTOR),
        timeline: await drawnBounds(page, BOTTOM_CHROME_SELECTOR),
        earthActive: state?.sectionId === 'earth' ? 1 : 0,
        insideChrome: insideChrome ? 1 : 0,
      }
    },
    expect: {
      // Three pills wide enough to hold an icon and a caps-mono label, unmistakably present.
      'shortcuts.width': [140, 420],
      'shortcuts.height': [16, 60],
      // Unchanged from `bottom-chrome-height`'s own desktop band — proof this group added no
      // height to the timeline's own (2026-09-18 condensing pass) chrome, even now that it is
      // folded inside it rather than sitting beside the title.
      'timeline.height': [135, 175],
      earthActive: [1, 1],
      insideChrome: [1, 1],
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
  {
    name: 'co2-chart-log-axis-regression',
    description:
      "CO2's own full chart, at present day, over the full Earth domain — `chartAxis.ts`'s shared ratio test now " +
      "puts CO2's ~42x range (173-7,331 ppm) on a log axis too, where it was unconditionally linear before this " +
      "pass. Guards that the change is a real improvement (labelled, still drawn, industrial-era rise no longer " +
      "flattened to nothing) and that CO2's real declared gap (ADR-027, ice-core/GEOCARB join) still breaks the " +
      'line rather than bridging it under the new axis math.',
    viewport: DEFAULT_VIEWPORT,
    t: 0,
    actions: async ({ page }) => {
      // Explicitly back to the root "Earth" section (full 4.6 Gyr domain), not whatever a
      // shot earlier in the same run left `sectionId` at — this harness runs every shot
      // against one already-loaded page (README), and the CO2 chart's own axis choice is a
      // function of the range actually visible under the *current* section's scale, not the
      // layer's full range: opened under a narrowed section (e.g. this file's own "Humans"
      // shots), the visible slice of CO2 can easily fail the log-axis ratio test even though
      // the full-domain chart passes it, which would be this section's own scale leaking into
      // the shot, not a real regression.
      await page.getByRole('button', { name: 'Earth — the Earth' }).click()
      const chartToggle = page.getByRole('button', { name: /^(Expand|Collapse) Atmospheric CO. chart$/ })
      if ((await chartToggle.getAttribute('aria-pressed')) !== 'true') await chartToggle.click()
    },
    measure: async ({ page }) => {
      const curve = await polylineTraceBounds(page, '[data-testid="layer-chart-svg"]')
      const text = (await page.textContent('[data-testid="layer-chart"]')) ?? ''
      return {
        curveWidth: curve.width,
        curveHeight: curve.height,
        showsPpm: text.includes('ppm') ? 1 : 0,
        showsLogScale: text.includes('log scale') ? 1 : 0,
      }
    },
    expect: {
      curveWidth: [1000, 1440],
      curveHeight: [60, 110],
      showsPpm: [1, 1],
      showsLogScale: [1, 1],
    },
  },
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
      "`layer.timeDomain` instead of the passed scale's domain (still using that scale's `kind` — symlog). This " +
      "shot asserts the population sparkline's DRAWN trace (not its SVG box) is comparably sized to CO2's own, " +
      'sitting directly beneath its own value — not the coordinator\'s read of a collision with CO2\'s row (that ' +
      "reading doesn't survive: `getBoundingClientRect` on both readouts shows two fully separate rows, ~110px " +
      'apart, no overlap — see this shot\'s own `rowsOverlap`/`popBelowOwnValue` checks).',
    viewport: DEFAULT_VIEWPORT,
    t: 10,
    measure: async ({ page }) => {
      // `polylineTraceBounds`, not `drawnBounds`: both sparklines sit directly over the scene
      // photo with no opaque backing, and `drawnBounds`' own corner-sampled background check is
      // fooled by that photo's texture alone (see that helper's own doc comment) — a real risk
      // this exact shot could otherwise have papered over.
      const co2 = await polylineTraceBounds(page, '[data-testid="scalar-readout-co2"] svg')
      const pop = await polylineTraceBounds(page, '[data-testid="scalar-readout-population"] svg')
      const co2Box = await page.locator('[data-testid="scalar-readout-co2"]').boundingBox()
      const popBox = await page.locator('[data-testid="scalar-readout-population"]').boundingBox()
      const popValue = await page
        .locator('[data-testid="scalar-readout-population"] [data-testid="scalar-readout-value"]')
        .boundingBox()
      return {
        co2Width: co2.width,
        co2Height: co2.height,
        popWidth: pop.width,
        popHeight: pop.height,
        // Two readouts stacked in their own column, never sharing a row.
        rowsOverlap: co2Box && popBox && co2Box.y < popBox.y + popBox.height && popBox.y < co2Box.y + co2Box.height ? 1 : 0,
        // The sparkline's own drawn top sits below the population value text's own bottom —
        // "beneath the current count", not beside CO2's.
        popBelowOwnValue: popValue && pop.y >= popValue.y + popValue.height - 1 ? 1 : 0,
      }
    },
    expect: {
      // CO2's own drawn width/height as the reference "legible, like CO2's" bar — population
      // should be in the same ballpark, not an order of magnitude smaller.
      popWidth: [120, 200],
      popHeight: [15, 32],
      rowsOverlap: [0, 0],
      popBelowOwnValue: [1, 1],
    },
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
  {
    name: 'co2-sparkline-grows-with-t',
    description:
      "Same growth check as `population-sparkline-grows-with-t`, for CO2's own sparkline — the user's ask named " +
      'both graphs explicitly ("the population and co2 graph lines"). CO2\'s own real published domain is ' +
      '[0, 5.7e8]; sweeps from just past that oldest edge through to present.',
    viewport: DEFAULT_VIEWPORT,
    t: 5.7e8 + 1,
    measure: async ({ page, hook }) => {
      const widthAt = async (t) => {
        await hook.setT(t)
        await hook.ready()
        await rafTicks(page, 2)
        const trace = await polylineTraceBounds(page, '[data-testid="scalar-readout-co2"] svg')
        return trace.width
      }
      // 3e8 (not right at CO2's own oldest edge, 5.7e8): same reasoning as the population
      // shot's own "early" choice — enough reached points for a real, assertable width, not
      // just the bare two-point minimum a coarse 97-sample grid needs to draw anything at all.
      const beforeDomain = await widthAt(5.7e8 + 1)
      const early = await widthAt(3e8)
      const mid = await widthAt(1e8)
      const late = await widthAt(0)
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
      earlyGrowth: [5, 200],
      midGrowth: [5, 200],
      lateGrowth: [5, 200],
      late: [120, 200],
    },
  },
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
