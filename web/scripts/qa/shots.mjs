/**
 * The shot list — data, not code. Adding a check means adding one object here; `run.mjs` never
 * needs to change. See `README.md` for the full `Shot` contract; the gist:
 *
 * - `t` and `state` are declarative: the runner applies them through `window.__earthlapse` before
 *   every measurement, in a fixed, safe order (pause -> `t` -> globe expand -> globe view mode ->
 *   layer toggles) so a shot only has to name the end state it wants.
 * - `actions`, when the declarative `state` isn't enough, is an async function run after `state`
 *   is applied and before the runner's own `ready()`/settle wait and screenshot.
 * - `measure` returns whatever numeric facts the shot cares about; `expect` asserts numeric
 *   ranges against dot-paths into that object.
 *
 * Several shots take one setup and measure a sequence of states from it (a viewport loop, a `t`
 * sweep, a click sequence): each such shot's `expect` still names every assertion separately.
 */

import { rafTicks, waitForGlobeFitFramesStable } from './hook.mjs'
import { boxOf, drawnBounds, drawnBoundsInClip, gapBetween, hiddenBoxOf, reducePixels } from './measure.mjs'
import { waitForApproxUnfoldProgress, waitForSceneCrossfadeSettle } from './timeouts.mjs'
import {
  BOTTOM_CHROME_SELECTOR,
  BREADCRUMB_CURRENT_SELECTOR,
  BREADCRUMB_SELECTOR,
  ERA_SHORTCUTS_SELECTOR,
  EVENT_FEED_ITEM_SELECTOR,
  GLOBE_CANVAS_SELECTOR,
  GLOBE_EXPAND_SELECTOR,
  GLOBE_MAP_FIT_FRAME_SELECTOR,
  GLOBE_SPHERE_FIT_FRAME_SELECTOR,
  ONBOARDING_CARD_SELECTOR,
  ONBOARDING_SKIP_SELECTOR,
  ONBOARDING_SPOTLIGHT_SELECTOR,
  OVERLAY_SELECT_SELECTOR,
  PLAY_BUTTON_SELECTOR,
  SCENE_CANVAS_SELECTOR,
  SECTION_BANDS_SELECTOR,
  SHELL_FEED_SELECTOR,
  SHELL_READOUTS_SELECTOR,
  TIMELINE_CONTROLS_CORE_SELECTOR,
  TIMELINE_CONTROLS_SECONDARY_SELECTOR,
  TIMELINE_CONTROLS_SECTIONS_SELECTOR,
  TIMELINE_TRACK_STACK_SELECTOR,
  VIEW_MODE_TOGGLE_SELECTOR,
  ZOOM_CONTROLS_SELECTOR,
} from './selectors.mjs'

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
/** Portrait phone at the 390px floor the layout is sized for. */
const PHONE_FLOOR_VIEWPORT = { width: 390, height: 844 }
/** Narrow desktop, just above the 760px phone breakpoint's tablet range. */
const NARROW_DESKTOP_VIEWPORT = { width: 1000, height: 810 }
/** A 6.1" phone held sideways: the short-landscape layout (ADR-048). */
const LANDSCAPE_VIEWPORT = { width: 844, height: 390 }

/** The expanded globe's corner wrappers and close button (`Globe.tsx`). */
const OVERLAY_SELECT_STACK_SELECTOR = '[data-testid="globe-overlay-select-stack"]'
const LEGEND_CORNER_SELECTOR = '[data-testid="globe-legend-corner"]'
const CLOSE_BUTTON_SELECTOR = '[data-testid="globe-close-button"]'
/** The current-time heading (`Experience.tsx`'s `<TimeTitle>`). */
const TIME_TITLE_SELECTOR = '[data-testid="time-title"]'
const SCENE_CAPTION_TITLE_SELECTOR = '[data-testid="scene-caption-title"]'
const SCENE_CAPTION_TEXT_SELECTOR = '[data-testid="scene-caption-text"]'
const SCENE_CAPTION_DETAIL_SELECTOR = '[data-testid="scene-caption-detail"]'
const SCENE_CAPTION_BUTTON_SELECTOR = '[data-testid="scene-caption-button"]'
const ANCESTOR_PORTRAIT_SELECTOR = '[data-testid="ancestor-portrait"]'
const ANCESTOR_READOUT_SELECTOR = '[data-testid="ancestor-readout"]'
const ABOUT_BUTTON_SELECTOR = 'button[aria-label="About & credits"]'
const POPULATION_READOUT_SELECTOR = '[data-testid="scalar-readout-population"]'
const EVENT_BROWSER_SELECTOR = '[data-testid="event-browser"]'
const EVENT_FEED_BROWSE_SELECTOR = '[data-testid="event-feed-browse"]'
const LAYER_CHART_SVG_SELECTOR = '[data-testid="layer-chart-svg"]'
const GLOBE_TOOLTIP_HINT_SELECTOR = '[data-testid="globe-tooltip-hint"]'
const PLAYHEAD_LABEL_SELECTOR = `${TIMELINE_TRACK_STACK_SELECTOR} [class*="timeLabel"]`

/** The legend panel's compact ceiling. The panel measures 48.5px (single row, `padding: 6px 10px`,
 *  `line-height: 1.25`, short hint); an uncompacted one — 8px padding, 1.4 line-height, a two-line
 *  hint — measures 68px. 60px sits strictly between the two, so this discriminates rather than
 *  passing both. */
const LEGEND_HEIGHT_CEILING_PX = 60

/** Above the atmosphere glow's own contrast against the flat backdrop `hideSceneAndVignette`
 *  leaves, well below the sphere's — so a scan measures the sphere, not its halo. */
const SPHERE_OVER_GLOW_THRESHOLD = 90

/**
 * A thin horizontal strip through the expanded globe's vertical centre at 1440x900, clear of every
 * piece of chrome (toggle, legend, close button, zoom controls) that would contaminate a scan of
 * the full-viewport `<canvas>`. Width-only on purpose: the default sphere already fills nearly the
 * whole vertical gap between title and timeline, so there is no chrome-free room to prove vertical
 * growth into — and a circle that grows wider grows taller by the same factor. Margins were picked
 * against screenshots, not derived from CSS; a chrome change that moves into this band needs this
 * constant nudged.
 */
const GLOBE_CHROME_FREE_STRIP = { x: 20, y: 360, width: 1320, height: 100 }

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Whether two `{x, y, width, height}` boxes intersect. Half-open: two boxes exactly edge to edge
 *  read as clear, matching how CSS layout treats adjacency. */
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Distance between two boxes' centres — how a shot proves one element is placed *on* another
 *  rather than merely somewhere overlapping it. */
function centreDistance(a, b) {
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))
}

/** Signed separation between two boxes: the closest-point distance when apart, minus the
 *  shallower axis's overlap depth when they overlap. */
function rectClearancePx(a, b) {
  const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  if (gapX > 0 || gapY > 0) return Math.hypot(Math.max(gapX, 0), Math.max(gapY, 0))
  return -Math.min(-gapX, -gapY)
}

/** How far a box pokes outside the viewport on its worst side — 0 or less when fully inside. */
function viewportOverflowPx(box, viewport) {
  return Math.max(-box.x, -box.y, box.x + box.width - viewport.width, box.y + box.height - viewport.height)
}

/** The smallest box containing every box given. */
function unionBox(boxes) {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

const centreX = (box) => box.x + box.width / 2
const centreY = (box) => box.y + box.height / 2

/** Every unordered pair of `names`, in order. */
function namePairs(names) {
  return names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b]))
}

/** Whether each pair among `boxes` (a name -> box map) overlaps, as `overlap_<a>_<b>` flags. */
function pairwiseOverlapFlags(boxes) {
  return Object.fromEntries(namePairs(Object.keys(boxes)).map(([a, b]) => [`overlap_${a}_${b}`, rectsOverlap(boxes[a], boxes[b]) ? 1 : 0]))
}

/** `expect` entries asserting no pair among `names` overlaps. */
function noPairOverlaps(names) {
  return Object.fromEntries(namePairs(names).map(([a, b]) => [`overlap_${a}_${b}`, [0, 0]]))
}

/** Number of overlapping pairs among `boxes`. */
function overlappingPairCount(boxes) {
  return namePairs(boxes.map((_, i) => i)).filter(([a, b]) => rectsOverlap(boxes[a], boxes[b])).length
}

/**
 * The layout box of each named selector's first match, read in one round trip. Throws naming any
 * that is missing or not rendered (zero size), so a renamed test id fails loudly.
 * @param {import('playwright').Page} page
 * @param {Record<string, string>} selectors name -> selector
 * @returns {Promise<Record<string, {x: number, y: number, width: number, height: number}>>}
 */
async function boxesOf(page, selectors) {
  const boxes = await page.evaluate(
    (entries) =>
      Object.fromEntries(
        entries.map(([name, sel]) => {
          const rect = document.querySelector(sel)?.getBoundingClientRect()
          return [name, rect === undefined || (rect.width === 0 && rect.height === 0) ? null : rect.toJSON()]
        }),
      ),
    Object.entries(selectors),
  )
  const missing = Object.keys(boxes).filter((name) => boxes[name] === null)
  if (missing.length > 0) throw new Error(`boxesOf: nothing rendered for ${missing.map((name) => `${name} (${selectors[name]})`).join(', ')}`)
  return boxes
}

/** `overlap_<a>_<b>` for every pair of `boxes` plus `offscreen_<name>`, how far each pokes out of
 *  the viewport (≤ 0 inside) — the whole "no chrome region collides or is clipped" check. */
function layoutFlags(boxes, viewport) {
  return {
    ...pairwiseOverlapFlags(boxes),
    ...Object.fromEntries(Object.entries(boxes).map(([name, box]) => [`offscreen_${name}`, viewportOverflowPx(box, viewport)])),
  }
}

/** `expect` entries for `layoutFlags` over `names`: no pair overlaps, nothing leaves the viewport. */
function layoutExpect(names) {
  return { ...noPairOverlaps(names), ...Object.fromEntries(names.map((name) => [`offscreen_${name}`, [-4000, 0]])) }
}

/** Layout rects of every direct child of `selector`'s first match, `[]` when it is absent. */
function childRects(page, selector) {
  return page.evaluate(
    (sel) => Array.from(document.querySelector(sel)?.children ?? []).map((el) => el.getBoundingClientRect().toJSON()),
    selector,
  )
}

/** Layout rects of every element matching `selector`. */
function allRects(page, selector) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.getBoundingClientRect().toJSON()), selector)
}

/** The union box of every `<polyline>` inside `containerSelector`'s first match, `{0,0,0,0}` when
 *  there are none. Real SVG geometry, not a pixel scan: a sparkline or chart trace sits over the
 *  photographic scene with no opaque backing, where a corner-sampled pixel diff reads the photo's
 *  own texture as content (measured 173px of "width" over an empty SVG). */
async function polylineTraceBounds(page, containerSelector) {
  const boxes = await allRects(page, `${containerSelector} polyline`)
  return boxes.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : unionBox(boxes)
}

/** The rate picker inside the transport row. */
const RATE_PICKER_SELECTOR = `${TIMELINE_CONTROLS_CORE_SELECTOR} [role="spinbutton"]`

/**
 * The rate readout's drawn text rect (a `Range` over its first non-empty text node, not the
 * fixed-width slot around it), read while playing in steady mode from `t` — the one state it
 * shows a number in. Pauses and restores the playback mode and `t` before returning.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 * @param {number} t
 */
async function playingRateReadoutText(page, hook, t) {
  const { t: tBefore, playback } = await hook.getState()
  await hook.setT(t)
  await hook.setPlaybackMode('steady')
  await hook.setPlaying(true)
  try {
    return await page.evaluate(async (coreSelector) => {
      const textRect = () => {
        const slot = document.querySelector(`${coreSelector} [data-visible="true"]`)
        if (slot === null) return null
        const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent.trim() === '') continue
          const range = document.createRange()
          range.selectNodeContents(node)
          return range.getBoundingClientRect().toJSON()
        }
        return null
      }
      for (let i = 0; i < 120; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const rect = textRect()
        if (rect !== null) return rect
      }
      throw new Error('playingRateReadoutText: the rate readout never showed a number')
    }, TIMELINE_CONTROLS_CORE_SELECTOR)
  } finally {
    await hook.setPlaying(false)
    await hook.setPlaybackMode(playback.mode)
    await hook.setT(tBefore)
  }
}

/** `OverlaySelect.tsx`'s own bordered `.control` box (swatch + `<select>`): the `<select>`'s
 *  immediate parent, since the control carries no `data-testid` of its own. */
function overlayControlBox(page) {
  return page.evaluate((sel) => {
    const control = document.querySelector(sel)?.parentElement
    if (!control) throw new Error('overlayControlBox: no [data-testid="overlay-select"] parent found')
    return control.getBoundingClientRect().toJSON()
  }, OVERLAY_SELECT_SELECTOR)
}

// ---------------------------------------------------------------------------------------------
// Pixel reducers — `reducePixels` runs each in the page from its source, so each is
// self-contained.
// ---------------------------------------------------------------------------------------------

/** Bounding box of pixels at least `minAlpha` opaque, from a black-backdrop/white-backdrop pair:
 *  compositing gives `result = content*a + backdrop*(1-a)`, so the pair differs by exactly
 *  `255 * (1 - a)` and the content's own colour cancels out. */
function opaqueBounds([black, white], { minAlpha }) {
  const { width, height } = black
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const diff =
        (Math.abs(white.data[i] - black.data[i]) + Math.abs(white.data[i + 1] - black.data[i + 1]) + Math.abs(white.data[i + 2] - black.data[i + 2])) / 3
      if (1 - diff / 255 >= minAlpha) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Mean luma of the second image (0-255) and its mean per-channel difference from the first, as a
 *  percentage of full scale. */
function lumaAndChange([before, after]) {
  let luma = 0
  let change = 0
  const pixels = after.width * after.height
  for (let i = 0; i < after.data.length; i += 4) {
    luma += 0.2126 * after.data[i] + 0.7152 * after.data[i + 1] + 0.0722 * after.data[i + 2]
    change += Math.abs(after.data[i] - before.data[i]) + Math.abs(after.data[i + 1] - before.data[i + 1]) + Math.abs(after.data[i + 2] - before.data[i + 2])
  }
  return { meanLuma: luma / pixels, changePct: (100 * change) / (pixels * 3 * 255) }
}

// ---------------------------------------------------------------------------------------------
// Pixel measurements
// ---------------------------------------------------------------------------------------------

/**
 * Jumps to the scene whose full image is `image` while holding that image's request, so the
 * renderer can only draw the scene's thumbnail (ADR-051), and reads the scene canvas alone once
 * the crossfade has settled: its mean luma (a black frame reads ~0) and how much it changed from
 * the scene shown before (the previous scene kept on screen reads ~0). `heldRequests` is how many
 * requests the hold caught: 0 means the full image was already cached and the reading proves
 * nothing. Releases the hold and returns to `restoreT` before resolving.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 * @param {{ image: string, t: number, restoreT: number }} target
 */
async function heldFullImageDraw(page, hook, { image, t, restoreT }) {
  const sceneOnly = await page.addStyleTag({
    content: `body * { visibility: hidden !important; } ${SCENE_CANVAS_SELECTOR} { visibility: visible !important; }`,
  })
  await rafTicks(page, 2)
  const before = await page.screenshot()
  let heldRequests = 0
  let release = () => {}
  const held = new Promise((resolve) => {
    release = resolve
  })
  // Left registered once released, as in `loading-screen`: unrouting while a held
  // `route.continue()` is unresolved races Playwright's cleanup.
  await page.route(`**/${image}`, async (route) => {
    heldRequests += 1
    await held
    await route.continue()
  })
  await hook.setT(t)
  await waitForSceneCrossfadeSettle(page)
  await rafTicks(page, 2)
  const after = await page.screenshot()
  release()
  await sceneOnly.evaluate((el) => el.remove())
  await hook.setT(restoreT)
  await hook.ready()
  await waitForSceneCrossfadeSettle(page)
  return { heldRequests, ...(await reducePixels(page, [before, after], lumaAndChange)) }
}

const roundClip = (clip) => ({ x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) })

/**
 * Hides `ShellLayout.tsx`'s scene layer and lens vignette (the `.shell` root's first two
 * children) so a screenshot behind them reads as a flat, static backdrop instead of the photo,
 * which keeps drifting (parallax breathing) even paused under reduced motion. `visibility`, so
 * nothing reflows. Returns a restore callback.
 * @param {import('playwright').Page} page
 * @returns {Promise<() => Promise<void>>}
 */
async function hideSceneAndVignette(page) {
  const setVisibility = (value) =>
    page.evaluate((v) => {
      const shell = document.querySelector('[data-globe-expanded]')
      if (shell && shell.children.length >= 2) {
        shell.children[0].style.visibility = v
        shell.children[1].style.visibility = v
      }
    }, value)
  await setVisibility('hidden')
  return () => setVisibility('')
}

/**
 * The bounding box of what is at least `minAlpha` opaque inside `clip`, by a black/white
 * difference matte (`opaqueBounds`) with the scene and vignette hidden — for a soft edge (the
 * ancestor portrait's feathered mask, a caption scrim) or content on a busy photo, where a
 * corner-sampled pixel diff cannot tell a half-transparent fade from dark content.
 * @param {import('playwright').Page} page
 * @param {{x: number, y: number, width: number, height: number}} clip page-absolute CSS px
 * @param {{ minAlpha?: number, hide?: (page: import('playwright').Page) => Promise<() => Promise<unknown>> }} [options]
 *   `hide` hides whatever else must not count, returning a restore callback (default: the scene
 *   and vignette).
 */
async function opacityMatteBounds(page, clip, { minAlpha = 0.5, hide = hideSceneAndVignette } = {}) {
  const rounded = roundClip(clip)
  const restoreScene = await hide(page)
  const setBackdrop = (color) =>
    page.evaluate((c) => {
      const shell = document.querySelector('[data-globe-expanded]')
      if (shell) shell.style.background = c
    }, color)
  await setBackdrop('#000000')
  const black = await page.screenshot({ clip: rounded })
  await setBackdrop('#ffffff')
  const white = await page.screenshot({ clip: rounded })
  await setBackdrop('')
  await restoreScene()
  const local = await reducePixels(page, [black, white], opaqueBounds, { minAlpha })
  return { x: rounded.x + local.x, y: rounded.y + local.y, width: local.width, height: local.height }
}

/** Hides the scene, vignette and event feed (which rides above the expanded globe in the left
 *  column) — everything a scan of `GLOBE_CHROME_FREE_STRIP` would otherwise pick up besides the
 *  sphere. Returns a restore callback. */
async function hideAroundSphereStrip(page) {
  const setVisibility = (value) =>
    page.evaluate(
      ([feedSelector, v]) => {
        const shell = document.querySelector('[data-globe-expanded]')
        for (const el of [shell?.children[0], shell?.children[1], document.querySelector(feedSelector)]) if (el) el.style.visibility = v
      },
      [SHELL_FEED_SELECTOR, value],
    )
  await setVisibility('hidden')
  return () => setVisibility('')
}

/** The drawn diameter of the minimised globe orb, with the scene hidden so only the sphere counts. */
async function minimisedOrbDrawnBounds(page) {
  const canvas = await hiddenBoxOf(page, GLOBE_CANVAS_SELECTOR)
  const restoreScene = await hideSceneAndVignette(page)
  const bounds = await drawnBoundsInClip(page, canvas, { threshold: SPHERE_OVER_GLOW_THRESHOLD })
  await restoreScene()
  return bounds
}

/**
 * The minimised orb's drawn limb: what is at least half opaque inside its canvas (`opacityMatteBounds`),
 * with the scene, vignette, halo and corner expand glyph hidden so only the sphere counts.
 * @param {import('playwright').Page} page
 */
async function minimisedOrbLimbBounds(page) {
  const hide = async (p) => {
    const restoreScene = await hideSceneAndVignette(p)
    const setVisibility = (value) =>
      p.evaluate((v) => {
        for (const el of document.querySelectorAll('div[data-map-mode] [class*="halo"], div[data-map-mode] [class*="expandGlyph"]')) el.style.visibility = v
      }, value)
    await setVisibility('hidden')
    return async () => {
      await setVisibility('')
      await restoreScene()
    }
  }
  return opacityMatteBounds(page, await boxOf(page, GLOBE_CANVAS_SELECTOR), { minAlpha: 0.5, hide })
}

/**
 * Hides everything but the expanded globe's own canvas — the scene, the vignette, the shell's HUD
 * slots other than the globe's, and `chromeSelectors` — so a whole-viewport scan sees the drawn
 * sphere or map alone against the flat backdrop. Returns a restore callback.
 * @param {import('playwright').Page} page
 * @param {string[]} chromeSelectors
 */
async function hideAllButGlobeCanvas(page, chromeSelectors) {
  await page.evaluate((selectors) => {
    const shell = document.querySelector('[data-globe-expanded]')
    const hud = shell?.children[2]
    const targets = [shell?.children[0], shell?.children[1]]
    if (hud) for (const child of hud.children) if (!child.contains(document.querySelector('div[data-map-mode]'))) targets.push(child)
    for (const selector of selectors) targets.push(...document.querySelectorAll(selector))
    for (const el of targets) {
      if (el instanceof HTMLElement) {
        el.dataset.qaHidden = el.style.visibility
        el.style.visibility = 'hidden'
      }
    }
  }, chromeSelectors)
  return () =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-qa-hidden]')) {
        el.style.visibility = el.dataset.qaHidden
        delete el.dataset.qaHidden
      }
    })
}

/** The expanded globe's own controls, hidden along with everything else by `globeBodyBounds`. */
const GLOBE_CHROME_SELECTORS = [
  LEGEND_CORNER_SELECTOR,
  OVERLAY_SELECT_STACK_SELECTOR,
  CLOSE_BUTTON_SELECTOR,
  VIEW_MODE_TOGGLE_SELECTOR,
  ZOOM_CONTROLS_SELECTOR,
  TIME_TITLE_SELECTOR,
  ERA_SHORTCUTS_SELECTOR,
]

/**
 * The drawn body of the expanded sphere or map: an opacity matte (`opacityMatteBounds`) with
 * everything but the globe canvas hidden, counting only fully opaque pixels. The atmosphere glow
 * is composited translucently, so it drops out, where a brightness threshold cannot separate its
 * bright inner edge from the sphere. Scanned over the fit frame plus a margin, so a shape drawn
 * smaller or somewhat larger than its frame reads as such.
 * @param {import('playwright').Page} page
 * @param {string} fitFrameSelector
 */
async function globeBodyBounds(page, fitFrameSelector) {
  const MARGIN_PX = 48
  const frame = await hiddenBoxOf(page, fitFrameSelector)
  const viewport = page.viewportSize()
  const x = Math.max(0, frame.x - MARGIN_PX)
  const y = Math.max(0, frame.y - MARGIN_PX)
  const clip = { x, y, width: Math.min(viewport.width, frame.x + frame.width + MARGIN_PX) - x, height: Math.min(viewport.height, frame.y + frame.height + MARGIN_PX) - y }
  return opacityMatteBounds(page, clip, { minAlpha: 0.99, hide: (p) => hideAllButGlobeCanvas(p, GLOBE_CHROME_SELECTORS) })
}

/** Sample points (every `step` px) where two screenshots of one clip differ, strongest first. */
function differingPoints([a, b], { step }) {
  const points = []
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const i = (y * a.width + x) * 4
      const diff = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      if (diff > 60) points.push([x, y, diff])
    }
  }
  return points.sort((p, q) => q[2] - p[2])
}

/**
 * Where the expanded sphere draws the human-civilisation layer: the sphere's fit frame screenshotted
 * with the layer on and off, differing points strongest first, in page coordinates.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 */
async function humanLayerPoints(page, hook) {
  const clip = roundClip(await hiddenBoxOf(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR))
  const on = await page.screenshot({ clip })
  await hook.setLayerToggle('human-civilisation', false)
  await rafTicks(page, 2)
  const off = await page.screenshot({ clip })
  await hook.setLayerToggle('human-civilisation', true)
  await rafTicks(page, 2)
  return (await reducePixels(page, [on, off], differingPoints, { step: 2 })).map(([x, y]) => [clip.x + x, clip.y + y])
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/** Whether the page is currently emulating `prefers-reduced-motion: reduce`. */
function motionReduced(page) {
  return page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/** Presses the expanded globe's "Zoom in" button `steps` times. */
async function pressZoomIn(page, steps) {
  const button = page.getByRole('button', { name: 'Zoom in' })
  for (let i = 0; i < steps; i += 1) {
    await button.click()
    await rafTicks(page, 2)
  }
}

/** Switches the expanded globe's view mode and waits for it to settle: the unfold tween when
 *  motion is on (under reduced motion it snaps), then the fit frames. */
async function switchGlobeViewMode(page, hook, mode) {
  await hook.setGlobeViewMode(mode)
  if (!(await motionReduced(page))) await waitForApproxUnfoldProgress(page, 1.5)
  await waitForGlobeFitFramesStable(page)
}

/** Selects a section through the store (section navigation itself is vitest's to cover; these
 *  shots need only the layout inside one) and lets the breadcrumb and bands render. */
async function selectSection(page, hook, sectionId) {
  await hook.selectSection(sectionId)
  await hook.ready()
  await rafTicks(page, 2)
}

/** The scene caption's visible title and passage together (its host element is an empty portal
 *  target with no box of its own). */
async function captionBox(page) {
  const rects = await page.evaluate((sels) => {
    return sels
      .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
      .map((el) => el.getBoundingClientRect().toJSON())
      .filter((rect) => rect.width > 0 && rect.height > 0)
  }, [SCENE_CAPTION_TITLE_SELECTOR, SCENE_CAPTION_TEXT_SELECTOR, SCENE_CAPTION_BUTTON_SELECTOR])
  if (rects.length === 0) throw new Error('captionBox: no visible scene caption')
  return unionBox(rects)
}

/** The caption's own drawn label box: the short-landscape title button where it shows, else the
 *  title heading. */
async function captionLabelBox(page) {
  const button = page.locator(SCENE_CAPTION_BUTTON_SELECTOR).first()
  return (await button.isVisible()) ? boxOf(page, SCENE_CAPTION_BUTTON_SELECTOR) : boxOf(page, SCENE_CAPTION_TITLE_SELECTOR)
}

/** Every visible label in the event browser's section rail (`rail.ts`): how far the widest pokes
 *  past `panelRightPx`, and how many pairs of them overlap. */
async function eventBrowserRailLabelGeometry(page, panelRightPx) {
  const rects = await allRects(page, '[data-testid="event-browser-rail-label"]')
  const overflowPx = rects.reduce((max, r) => Math.max(max, r.x + r.width - panelRightPx), 0)
  return { overflowPx: Math.max(0, overflowPx), overlapCount: overlappingPairCount(rects), labelCount: rects.length }
}

/**
 * A finger tap at `(x, y)` through CDP touch events: touch start, one 1px move (a real finger never
 * lifts exactly where it landed), touch end. Chromium turns it into the pointer and click sequence
 * a phone produces. Needs a `touch: true` shot.
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 */
async function touchTap(page, x, y) {
  const cdp = await page.context().newCDPSession(page)
  const at = (dx) => [{ x: x + dx, y, id: 0, radiusX: 4, radiusY: 4, force: 1 }]
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(1) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

/**
 * @typedef {Object} ShotState
 * @property {boolean} [playing]
 * @property {boolean} [globeExpanded]
 * @property {'globe' | 'map'} [globeViewMode]
 * @property {Record<string, boolean>} [layerToggles]
 * @property {boolean} [tour] - open the first-visit tour (`@/onboarding`); defaults to dismissed
 */

/**
 * @typedef {Object} Shot
 * @property {string} name - filesystem-safe, used for the screenshot filename
 * @property {string} description - one line: what this shot asserts
 * @property {{width: number, height: number}} [viewport] - defaults to 1440x900
 * @property {'reduce' | 'no-preference'} [reducedMotion] - overrides the run's own --reduced-motion default
 * @property {number} [t] - years before present
 * @property {ShotState} [state]
 * @property {boolean} [touch] - run on the harness's `hasTouch` page, where touch input works
 * @property {(ctx: { page: import('playwright').Page, hook: ReturnType<typeof import('./hook.mjs').makeHook> }) => Promise<void>} [actions]
 * @property {(ctx: { page: import('playwright').Page, hook: ReturnType<typeof import('./hook.mjs').makeHook>, smoke: boolean }) => Promise<Record<string, unknown>>} [measure]
 * @property {Record<string, [number, number]> | ((mode: { smoke: boolean }) => Record<string, [number, number]>)} [expect] -
 *   dot-path into `measure`'s result -> [min, max]; a function picks the table for `--smoke` or the full run
 */

// ---------------------------------------------------------------------------------------------
// Layout shots: one per (key viewport × resting / globe expanded)
// ---------------------------------------------------------------------------------------------

/** The collapsed shell's chrome regions, for the pairwise no-overlap and in-viewport check. */
const RESTING_REGIONS = {
  title: TIME_TITLE_SELECTOR,
  era: ERA_SHORTCUTS_SELECTOR,
  orb: GLOBE_EXPAND_SELECTOR,
  readouts: SHELL_READOUTS_SELECTOR,
  feed: EVENT_FEED_ITEM_SELECTOR,
  timeline: BOTTOM_CHROME_SELECTOR,
}

/** The transport row's parts, for the same check inside the timeline. */
const TRANSPORT_ROW_REGIONS = {
  breadcrumb: BREADCRUMB_SELECTOR,
  speed: RATE_PICKER_SELECTOR,
  play: PLAY_BUTTON_SELECTOR,
  secondary: TIMELINE_CONTROLS_SECONDARY_SELECTOR,
}

/**
 * Desktop resting layout at one viewport, root section then three levels deep (Earth › Cenozoic ›
 * Quaternary › Holocene, the longest trail that still shows whole):
 * - no chrome region (title, era shortcuts, orb, readouts, feed, caption, timeline, ancestor
 *   column) overlaps another or leaves the viewport, at the root and in the section;
 * - the orb's drawn top (scene hidden) sits at the top inset the About button does, level with
 *   the ancestor column, its readouts 0-40px under it;
 * - the transport row: breadcrumb, rate picker, play, secondary cluster and (playing in steady)
 *   the rate readout's text clear of each other; the picker on the transport's centre line (where
 *   the readout sits is per viewport); the secondary cluster's children clear of each
 *   other; play on the track centre; transport midway between the band row and the viewport
 *   bottom, breadcrumb on its centre line; the breadcrumb and the secondary cluster inside the
 *   track's edges; the breadcrumb on one line; the current crumb whole; neither transport nor
 *   secondary cluster moving in x as the trail grows.
 * @param {{ width: number, height: number }} viewport
 * @param {{ description: string, expect: Record<string, [number, number]>,
 *   atRoot?: (page: import('playwright').Page) => Promise<Record<string, unknown>>,
 *   inSection?: (page: import('playwright').Page) => Promise<Record<string, unknown>> }} extra
 *   measurements this viewport adds, at the root and three sections deep (run last there)
 */
function desktopRestingShot(viewport, extra) {
  const regions = { ...RESTING_REGIONS, ancestor: ANCESTOR_PORTRAIT_SELECTOR }
  return {
    name: `layout-${viewport.width}x${viewport.height}-resting`,
    description:
      `Desktop ${viewport.width}x${viewport.height}, collapsed, at the root and three sections deep: no chrome region ` +
      'overlaps another or leaves the viewport; the drawn orb top-aligned (±4px) with the About button and ancestor ' +
      'column (±3px); the transport row (breadcrumb, rate picker, transport, secondary cluster and, playing in steady, ' +
      "the rate readout's text) clear of itself, the picker on the transport's centre line (±3px), " +
      'play on the track centre (±2px), transport vertically centred ' +
      '(±3px) with the breadcrumb on its line (±2px), row inside the track edges, breadcrumb on one line and whole, ' +
      `transport and secondary cluster fixed in x (±0.5px) as the trail grows${extra.description}`,
    viewport,
    t: 0,
    measure: async ({ page, hook }) => {
      const orb = await minimisedOrbDrawnBounds(page)
      const root = await boxesOf(page, { ...regions, about: ABOUT_BUTTON_SELECTOR, core: TIMELINE_CONTROLS_CORE_SELECTOR, secondary: TIMELINE_CONTROLS_SECONDARY_SELECTOR, track: TIMELINE_TRACK_STACK_SELECTOR })
      const rootLayout = layoutFlags({ ...Object.fromEntries(Object.keys(regions).map((name) => [name, root[name]])), caption: await captionBox(page) }, viewport)
      const extraAtRoot = extra.atRoot === undefined ? {} : await extra.atRoot(page)

      await selectSection(page, hook, 'holocene')
      const deep = await boxesOf(page, {
        ...regions,
        ...TRANSPORT_ROW_REGIONS,
        core: TIMELINE_CONTROLS_CORE_SELECTOR,
        sections: TIMELINE_CONTROLS_SECTIONS_SELECTOR,
        bands: SECTION_BANDS_SELECTOR,
        track: TIMELINE_TRACK_STACK_SELECTOR,
      })
      const deepLayout = layoutFlags({ ...Object.fromEntries(Object.keys(regions).map((name) => [name, deep[name]])), caption: await captionBox(page) }, viewport)
      const transport = await page.evaluate((sel) => document.querySelector(sel).parentElement.getBoundingClientRect().toJSON(), PLAY_BUTTON_SELECTOR)
      const rowParts = { breadcrumb: deep.breadcrumb, speed: deep.speed, transport, secondary: deep.secondary }
      const gapAbove = deep.play.y - (deep.bands.y + deep.bands.height)
      const gapBelow = viewport.height - (deep.play.y + deep.play.height)
      const sectionTops = (await childRects(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)).map((rect) => Math.round(rect.y))
      const currentCrumbTruncated = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        return el !== null && el.scrollWidth > el.clientWidth + 0.5 ? 1 : 0
      }, BREADCRUMB_CURRENT_SELECTOR)
      // 8 ka: inside the Holocene with room to play forward.
      const readout = await playingRateReadoutText(page, hook, 8_000)
      return {
        root: rootLayout,
        inSection: deepLayout,
        orb,
        orbTopOffsetPx: orb.y - root.about.y,
        orbToAncestorTopPx: orb.y - Math.min(root.about.y, root.ancestor.y),
        orbToReadoutsGapPx: root.readouts.y - (orb.y + orb.height),
        transportRow: pairwiseOverlapFlags({ ...rowParts, readout }),
        pickerCentreOffsetPx: centreY(deep.speed) - centreY(transport),
        readoutGapPx: readout.x - (transport.x + transport.width),
        readoutCentreOffsetPx: centreY(readout) - centreY(transport),
        readoutBelowGapPx: readout.y - (transport.y + transport.height),
        readoutCentreXOffsetPx: centreX(readout) - centreX(transport),
        readoutBottomInsetPx: viewport.height - (readout.y + readout.height),
        readoutTextWidthPx: readout.width,
        secondarySelfOverlaps: overlappingPairCount(await childRects(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)),
        playCentreOffsetPx: centreX(deep.play) - centreX(deep.track),
        coreCentreOffsetAtRootPx: Math.abs(centreX(root.core) - centreX(root.track)),
        centringDeltaPx: Math.abs(gapAbove - gapBelow),
        breadcrumbCentreOffsetPx: centreY(deep.breadcrumb) - centreY(deep.play),
        leftInsetPx: deep.sections.x - deep.track.x,
        rightInsetPx: deep.track.x + deep.track.width - (deep.secondary.x + deep.secondary.width),
        breadcrumbRows: new Set(sectionTops).size,
        currentCrumbTruncated,
        coreXDriftPx: Math.abs(deep.core.x - root.core.x),
        secondaryXDriftPx: Math.abs(deep.secondary.x - root.secondary.x),
        ...extraAtRoot,
        ...(extra.inSection === undefined ? {} : await extra.inSection(page)),
      }
    },
    expect: {
      ...Object.fromEntries(Object.entries(layoutExpect([...Object.keys(regions), 'caption'])).flatMap(([key, range]) => [[`root.${key}`, range], [`inSection.${key}`, range]])),
      orbTopOffsetPx: [-4, 4],
      orbToAncestorTopPx: [-3, 3],
      orbToReadoutsGapPx: [0, 40],
      ...Object.fromEntries(Object.entries(noPairOverlaps(['breadcrumb', 'speed', 'transport', 'secondary', 'readout'])).map(([key, range]) => [`transportRow.${key}`, range])),
      pickerCentreOffsetPx: [-3, 3],
      readoutTextWidthPx: [20, 120],
      secondarySelfOverlaps: [0, 0],
      playCentreOffsetPx: [-2, 2],
      coreCentreOffsetAtRootPx: [0, 3],
      centringDeltaPx: [0, 3],
      breadcrumbCentreOffsetPx: [-2, 2],
      leftInsetPx: [0, 400],
      rightInsetPx: [0, 400],
      breadcrumbRows: [1, 1],
      currentCrumbTruncated: [0, 0],
      coreXDriftPx: [0, 0.5],
      secondaryXDriftPx: [0, 0.5],
      ...extra.expect,
    },
  }
}

/**
 * Desktop expanded globe at one viewport, sphere then (with `withMap`) map. Legend (top-left) and
 * overlay selector (top-right, under the ✕) align their outer edges to the scrub track's at one
 * top; the era shortcuts stay centred under the title; the Globe/Map toggle and zoom rocker share
 * one row under the drawn shape, their outer edges on the track's; and no region — legend, title,
 * shortcuts, overlay, close button, toggle, zoom, timeline, drawn shape — overlaps another or
 * leaves the viewport. The drawn shape is the sphere's or map's opaque body (`globeBodyBounds`).
 * @param {{ width: number, height: number }} viewport
 * @param {{ sphereWidth?: [number, number], mapWidth?: [number, number], withMap?: boolean }} options
 */
function desktopExpandedShot(viewport, { sphereWidth, mapWidth, withMap = false } = {}) {
  const regionSelectors = {
    legend: LEGEND_CORNER_SELECTOR,
    title: TIME_TITLE_SELECTOR,
    era: ERA_SHORTCUTS_SELECTOR,
    overlay: OVERLAY_SELECT_STACK_SELECTOR,
    close: CLOSE_BUTTON_SELECTOR,
    toggle: VIEW_MODE_TOGGLE_SELECTOR,
    zoom: ZOOM_CONTROLS_SELECTOR,
    timeline: BOTTOM_CHROME_SELECTOR,
  }
  const measureMode = async (page, fitFrameSelector) => {
    const b = await boxesOf(page, { ...regionSelectors, track: TIMELINE_TRACK_STACK_SELECTOR })
    const shape = await globeBodyBounds(page, fitFrameSelector)
    const { track, ...regions } = b
    return {
      shape,
      layout: layoutFlags({ ...regions, shape }, viewport),
      legendLeftEdgeOffsetPx: b.legend.x - track.x,
      overlayRightEdgeOffsetPx: b.overlay.x + b.overlay.width - (track.x + track.width),
      legendOverlayTopDeltaPx: b.legend.y - b.overlay.y,
      legendHeightPx: b.legend.height,
      eraCentreOffsetPx: centreX(b.era) - centreX(b.title),
      overlayBelowCloseGapPx: b.overlay.y - (b.close.y + b.close.height),
      toggleLeftEdgeOffsetPx: b.toggle.x - track.x,
      zoomRightEdgeOffsetPx: b.zoom.x + b.zoom.width - (track.x + track.width),
      controlsCentreYDeltaPx: Math.abs(centreY(b.toggle) - centreY(b.zoom)),
      toggleBelowShapeGapPx: b.toggle.y - (shape.y + shape.height),
    }
  }
  const modeExpect = (prefix, widthRange) => ({
    [`${prefix}.shape.width`]: widthRange ?? [100, viewport.width],
    ...Object.fromEntries(Object.entries(layoutExpect([...Object.keys(regionSelectors), 'shape'])).map(([key, range]) => [`${prefix}.layout.${key}`, range])),
    [`${prefix}.legendLeftEdgeOffsetPx`]: [-2, 2],
    [`${prefix}.overlayRightEdgeOffsetPx`]: [-2, 2],
    [`${prefix}.legendOverlayTopDeltaPx`]: [-2, 2],
    [`${prefix}.legendHeightPx`]: [0, LEGEND_HEIGHT_CEILING_PX],
    [`${prefix}.eraCentreOffsetPx`]: [-3, 3],
    [`${prefix}.overlayBelowCloseGapPx`]: [4, 400],
    [`${prefix}.toggleLeftEdgeOffsetPx`]: [-2, 2],
    [`${prefix}.zoomRightEdgeOffsetPx`]: [-2, 2],
    [`${prefix}.controlsCentreYDeltaPx`]: [0, 4],
    [`${prefix}.toggleBelowShapeGapPx`]: [4, 400],
  })
  return {
    name: `layout-${viewport.width}x${viewport.height}-expanded`,
    description:
      `Desktop ${viewport.width}x${viewport.height}, globe expanded (sphere${withMap ? ', then map' : ''}): ` +
      `${sphereWidth ? `drawn sphere ${sphereWidth[0]}-${sphereWidth[1]}px, ` : ''}${mapWidth ? `drawn map ${mapWidth[0]}-${mapWidth[1]}px, ` : ''}` +
      'no region (legend, title, era shortcuts, overlay, close, Globe/Map toggle, zoom, timeline, drawn shape) overlaps ' +
      "another or leaves the viewport; legend, overlay, toggle and zoom on the track's edges (±2px); shortcuts centred " +
      'under the title (±3px); toggle and zoom on one row (±4px) at least 4px below the drawn shape' +
      (withMap ? '; the fully zoomed-out map shows no grab cursor.' : '.'),
    viewport,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page, hook }) => {
      const sphere = await measureMode(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR)
      if (!withMap) return { sphere }
      await switchGlobeViewMode(page, hook, 'map')
      const map = await measureMode(page, GLOBE_MAP_FIT_FRAME_SELECTOR)
      const cursor = await page.locator(GLOBE_CANVAS_SELECTOR).first().evaluate((el) => getComputedStyle(el).cursor)
      return { sphere, map, mapCursorIsNotGrab: cursor !== 'grab' ? 1 : 0 }
    },
    expect: {
      ...modeExpect('sphere', sphereWidth),
      ...(withMap ? { ...modeExpect('map', mapWidth), mapCursorIsNotGrab: [1, 1] } : {}),
    },
  }
}

/** `expect` keys for a `layoutFlags` result nested under `prefix`. */
function prefixedLayoutExpect(prefix, names) {
  return Object.fromEntries(Object.entries(layoutExpect(names)).map(([key, range]) => [`${prefix}.${key}`, range]))
}

// ---------------------------------------------------------------------------------------------
// The shot list
// ---------------------------------------------------------------------------------------------

/** The store as the phone orb tap shot found it, from its `actions` to its `measure`. */
let phoneOrbTapBefore = null

/** @type {Shot[]} */
export default [
  {
    name: 'loading-screen',
    description:
      'The loading screen is in the static HTML (drawn with scripts blocked), holds its globe still under reduced ' +
      'motion and turns it otherwise, advances its progress bar in steps as the manifest and then the first scene ' +
      "land, and is gone once the shell mounts. Owns the harness's one real page load (`bootstrapsPage`), held at " +
      'the first scene image so its screenshot catches the loader on screen.',
    viewport: DEFAULT_VIEWPORT,
    /**
     * The one shot allowed to own the harness's page load (README, "A shot that needs the
     * harness's one page load"): `run.mjs` calls this in place of its own `page.goto`, before
     * `window.__earthlapse` exists, so it drives `page` with raw Playwright only.
     * @param {{ page: import('playwright').Page, baseUrl: string, run: { screenshots: boolean } }} args
     */
    bootstrapsPage: async ({ page, baseUrl, run }) => {
      const LOADER = '[data-testid="loading-screen"]'
      const surfaceAnimation = (p) =>
        p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="loading-screen"] svg g g')).animationName)

      // Scripts never run on this side page, so there is no manifest or scene fetch to hold back.
      const noScript = await page.context().newPage()
      await noScript.setViewportSize(DEFAULT_VIEWPORT)
      await noScript.emulateMedia({ reducedMotion: 'reduce' })
      await noScript.route('**/*.js', (route) => route.abort())
      await noScript.goto(baseUrl, { waitUntil: 'load' })
      const staticProgress = Number(await noScript.getAttribute(`${LOADER} [role="progressbar"]`, 'aria-valuenow'))
      const staticTitle = (await noScript.textContent(LOADER))?.includes('Earthlapse') ? 1 : 0
      const reducedMotionStill = (await surfaceAnimation(noScript)) === 'none' ? 1 : 0
      await noScript.emulateMedia({ reducedMotion: 'no-preference' })
      const turnsOtherwise = (await surfaceAnimation(noScript)) !== 'none' ? 1 : 0
      await noScript.close()

      // The real, scripted load, held at the first scene image so the loader is still on screen.
      let releaseScenes = () => {}
      const scenesHeld = new Promise((resolve) => {
        releaseScenes = resolve
      })
      await page.route('**/scenes/*.webp', async (route) => {
        await scenesHeld
        await route.continue()
      })
      await page.goto(baseUrl, { waitUntil: 'commit' })
      const progressbar = `${LOADER} [role="progressbar"]`
      await page.waitForFunction((sel) => Number(document.querySelector(sel)?.getAttribute('aria-valuenow') ?? 0) > 0, progressbar)
      const midProgress = Number(await page.getAttribute(progressbar, 'aria-valuenow'))
      const globe = await drawnBounds(page, `${LOADER} svg`)
      const title = await drawnBounds(page, `${LOADER} p`)
      const screenshot = run.screenshots ? await page.screenshot() : null

      // Left registered: unrouting while an in-flight `route.continue()` is unresolved races
      // Playwright's cleanup ("Route is already handled!"), and once released every later match
      // is an immediate passthrough.
      releaseScenes()
      await page.waitForSelector(LOADER, { state: 'detached', timeout: 10_000 })
      const loaderAfterShell = await page.locator(LOADER).count()

      return {
        screenshot,
        measurements: {
          globeWidth: globe.width,
          titleWidth: title.width,
          titleHeight: title.height,
          staticProgress,
          staticTitle,
          reducedMotionStill,
          turnsOtherwise,
          midProgress,
          loaderAfterShell,
        },
      }
    },
    expect: {
      globeWidth: [60, 90],
      titleWidth: [80, 220],
      titleHeight: [6, 20],
      staticProgress: [0, 0],
      staticTitle: [1, 1],
      reducedMotionStill: [1, 1],
      turnsOtherwise: [1, 1],
      midProgress: [10, 20],
      loaderAfterShell: [0, 0],
    },
  },
  desktopRestingShot(DEFAULT_VIEWPORT, {
    description:
      "; the rate readout's text on the transport's centre line (±3px), 4-24px right of it; the orb's hover ring " +
      "100-106% of its drawn (alpha ≥ 0.5) limb; the scene canvas draws over at least half " +
      'the viewport; the timeline draws 135-175px tall; mode and scale ' +
      'share a row; the population sparkline trace is 120-200 x 15-32px beneath its value; the "All events" browser ' +
      '(`/`) is 300-720px wide, clear of the timeline, its rail labels inside it and apart; in the Holocene the ' +
      'expanded population chart stays on screen, clear of the timeline, its curve 1000-1440px wide.',
    atRoot: async (page) => {
      const [mode, scale] = await childRects(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      const trace = await polylineTraceBounds(page, `${POPULATION_READOUT_SELECTOR} svg`)
      const value = await boxOf(page, `${POPULATION_READOUT_SELECTOR} [data-testid="scalar-readout-value"]`)
      // Drawn pixels: a blank scene canvas has no extent at all against its own corners.
      const scene = await drawnBounds(page, SCENE_CANVAS_SELECTOR)
      const timeline = await drawnBounds(page, BOTTOM_CHROME_SELECTOR)
      // The hover/focus ring is the expand button's 1px box-shadow spread: its box plus 1px a side.
      const ringDiameterPx = (await boxOf(page, GLOBE_EXPAND_SELECTOR)).width + 2
      const limb = await minimisedOrbLimbBounds(page)

      await page.keyboard.press('/')
      const panel = await drawnBounds(page, EVENT_BROWSER_SELECTOR)
      const rail = await eventBrowserRailLabelGeometry(page, panel.x + panel.width)
      const browserOverlapsTimeline = rectsOverlap(panel, await boxOf(page, BOTTOM_CHROME_SELECTOR)) ? 1 : 0
      await page.keyboard.press('Escape')
      await rafTicks(page, 2)
      return {
        sceneDrawnFraction: scene.fractionOfViewport,
        timeline,
        ringDiameterPx,
        limbDiameterPx: limb.width,
        ringToLimbPct: (100 * ringDiameterPx) / limb.width,
        modeScaleShareRow: Math.round(mode.y) === Math.round(scale.y) ? 1 : 0,
        sparklineWidth: trace.width,
        sparklineHeight: trace.height,
        sparklineBelowValue: trace.y >= value.y + value.height - 1 ? 1 : 0,
        browserWidth: panel.width,
        browserOverlapsTimeline,
        railLabelCount: rail.labelCount,
        railLabelOverflowPx: rail.overflowPx,
        railLabelOverlapCount: rail.overlapCount,
      }
    },
    inSection: async (page) => {
      const toggle = page.getByRole('button', { name: /^(Expand|Collapse) Global population chart$/ })
      await toggle.click()
      await rafTicks(page, 2)
      const b = await boxesOf(page, { chart: '[data-testid="layer-chart"]', timeline: BOTTOM_CHROME_SELECTOR })
      const curve = await polylineTraceBounds(page, LAYER_CHART_SVG_SELECTOR)
      await toggle.click()
      return {
        chartOverlapsTimeline: rectsOverlap(b.chart, b.timeline) ? 1 : 0,
        chartOffscreenPx: viewportOverflowPx(b.chart, DEFAULT_VIEWPORT),
        chartCurveWidth: curve.width,
      }
    },
    expect: {
      sceneDrawnFraction: [0.5, 1],
      ringToLimbPct: [100, 106],
      'timeline.height': [135, 175],
      modeScaleShareRow: [1, 1],
      sparklineWidth: [120, 200],
      sparklineHeight: [15, 32],
      sparklineBelowValue: [1, 1],
      browserWidth: [300, 720],
      browserOverlapsTimeline: [0, 0],
      railLabelCount: [1, 40],
      railLabelOverflowPx: [0, 0],
      railLabelOverlapCount: [0, 0],
      chartOverlapsTimeline: [0, 0],
      chartOffscreenPx: [-1440, 0],
      chartCurveWidth: [1000, 1440],
      readoutGapPx: [4, 24],
      readoutCentreOffsetPx: [-3, 3],
    },
  }),
  desktopRestingShot(NARROW_DESKTOP_VIEWPORT, {
    description:
      "; the rate readout's text 0-12px under the transport, centred on it (±3px) and 4px or more above the viewport bottom; the secondary cluster is one row " +
      '(≤ 55px, mode and scale on one centre line ±2px).',
    atRoot: async (page) => {
      const [mode, scale] = await childRects(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)
      return {
        // One row of mode/scale/sound is ≤ 48px; a wrapped second line adds a control height (63px+).
        secondaryHeightPx: (await boxOf(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR)).height,
        modeScaleCentreYDeltaPx: Math.abs(centreY(mode) - centreY(scale)),
      }
    },
    expect: { readoutBelowGapPx: [0, 12], readoutCentreXOffsetPx: [-3, 3], readoutBottomInsetPx: [4, 810], secondaryHeightPx: [0, 55], modeScaleCentreYDeltaPx: [0, 2] },
  }),
  {
    name: 'layout-390x844-resting',
    description:
      'Phone portrait 390x844, collapsed: no chrome region (title, era shortcuts, orb, ancestor, readouts, feed strip, ' +
      'caption, timeline) overlaps another or leaves the viewport; the drawn orb 102-112% of the drawn portrait; the ' +
      'readouts sit 0-8px under the drawn orb and the shortcuts 8-14px under the title; the timeline draws 170-310px ' +
      'tall, its breadcrumb row taking no height at the root; the rate picker inside the transport row, clear of the ' +
      'transport buttons, the row no taller than the play button (1px); the secondary controls clear of each other and ' +
      'of the transport; in a section the stacked row stays inside the track (6px slack) without collisions and renders its ' +
      'crumbs; the feed strip paints no category word; its "All events" button, a 44-64px square clear of the card and ' +
      'inside the viewport, opens a full-width sheet above the timeline; ' +
      "the first-visit tour's first step rings the play button (±2px) with its card clear of the ring, ≥ 8px inside " +
      'the viewport, copy drawn on its panel, and a ≥ 44px Skip target.',
    viewport: PHONE_FLOOR_VIEWPORT,
    t: 0,
    measure: async ({ page, hook }) => {
      const regions = { ...RESTING_REGIONS, ancestor: ANCESTOR_PORTRAIT_SELECTOR }
      const root = await boxesOf(page, { ...regions, core: TIMELINE_CONTROLS_CORE_SELECTOR, secondary: TIMELINE_CONTROLS_SECONDARY_SELECTOR, picker: RATE_PICKER_SELECTOR, play: PLAY_BUTTON_SELECTOR })
      const layout = layoutFlags({ ...Object.fromEntries(Object.keys(regions).map((name) => [name, root[name]])), caption: await captionBox(page) }, PHONE_FLOOR_VIEWPORT)
      const transport = await page.evaluate((sel) => document.querySelector(sel).parentElement.getBoundingClientRect().toJSON(), PLAY_BUTTON_SELECTOR)
      const globe = await opacityMatteBounds(page, await boxOf(page, GLOBE_CANVAS_SELECTOR))
      const portrait = await opacityMatteBounds(page, await boxOf(page, ANCESTOR_PORTRAIT_SELECTOR))
      const timeline = await drawnBounds(page, BOTTOM_CHROME_SELECTOR)
      const orbToReadoutsPx = await gapBetween(page, GLOBE_CANVAS_SELECTOR, SHELL_READOUTS_SELECTOR)
      const titleToShortcutsPx = await gapBetween(page, TIME_TITLE_SELECTOR, ERA_SHORTCUTS_SELECTOR)
      const tag = await page.locator(`${SHELL_FEED_SELECTOR} [data-testid^="event-feed-card-"] [class*="tag"]`).first().boundingBox()
      const sectionsHeightAtRootPx = (await hiddenBoxOf(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)).height
      const secondarySelfOverlaps = overlappingPairCount(await childRects(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR))

      await hook.setTourOpen(true)
      await rafTicks(page, 2)
      const t = await boxesOf(page, { ring: ONBOARDING_SPOTLIGHT_SELECTOR, play: PLAY_BUTTON_SELECTOR, card: ONBOARDING_CARD_SELECTOR, skip: ONBOARDING_SKIP_SELECTOR })
      const tour = {
        ringToPlayOffsetPx: centreDistance(t.ring, t.play),
        cardOverlapsRing: rectsOverlap(t.card, t.ring) ? 1 : 0,
        cardOffscreenPx: viewportOverflowPx(t.card, PHONE_FLOOR_VIEWPORT),
        skip: t.skip,
        // Drawn pixels: the copy sits on the card's own flat panel, where a corner sample is sound.
        cardContent: await drawnBounds(page, ONBOARDING_CARD_SELECTOR),
      }
      await hook.setTourOpen(false)
      await rafTicks(page, 2)

      await selectSection(page, hook, 'cenozoic')
      const inSection = await boxesOf(page, { track: TIMELINE_TRACK_STACK_SELECTOR, sections: TIMELINE_CONTROLS_SECTIONS_SELECTOR, secondary: TIMELINE_CONTROLS_SECONDARY_SELECTOR })
      const crumbs = await allRects(page, `${BREADCRUMB_SELECTOR} ol > li`)
      const sectionCollisions = overlappingPairCount(await childRects(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR))
      const secondaryCollisions = overlappingPairCount(await childRects(page, TIMELINE_CONTROLS_SECONDARY_SELECTOR))

      const feed = await boxesOf(page, { card: EVENT_FEED_ITEM_SELECTOR, browse: EVENT_FEED_BROWSE_SELECTOR })
      await page.locator(EVENT_FEED_BROWSE_SELECTOR).click()
      await hook.ready()
      const sheet = await drawnBounds(page, EVENT_BROWSER_SELECTOR)
      return {
        layout,
        tour,
        globePortraitRatioPct: Math.round((100 * globe.width) / portrait.width),
        orbToReadoutsPx,
        titleToShortcutsPx,
        timeline,
        sectionsHeightAtRootPx,
        secondarySelfOverlaps,
        secondaryOverlapsCore: rectsOverlap(root.secondary, root.core) ? 1 : 0,
        pickerOutsideRowPx: Math.max(root.core.y - root.picker.y, root.picker.y + root.picker.height - (root.core.y + root.core.height)),
        rowTallerThanPlayPx: root.core.height - root.play.height,
        pickerOverlapsTransport: rectsOverlap(root.picker, transport) ? 1 : 0,
        leftInsetPx: inSection.sections.x - inSection.track.x,
        rightInsetPx: inSection.track.x + inSection.track.width - (inSection.secondary.x + inSection.secondary.width),
        sectionCollisions,
        secondaryCollisions,
        crumbsRendered: crumbs.filter((box) => box.width > 0 && box.height > 0).length,
        feedTagWidthPx: tag === null ? 0 : tag.width,
        browse: feed.browse,
        browseOverlapsCard: rectsOverlap(feed.browse, feed.card) ? 1 : 0,
        browseOffscreenPx: viewportOverflowPx(feed.browse, PHONE_FLOOR_VIEWPORT),
        eventSheetWidthPx: sheet.width,
        eventSheetOverlapsTimeline: rectsOverlap(sheet, await boxOf(page, BOTTOM_CHROME_SELECTOR)) ? 1 : 0,
      }
    },
    expect: {
      ...prefixedLayoutExpect('layout', [...Object.keys(RESTING_REGIONS), 'ancestor', 'caption']),
      globePortraitRatioPct: [102, 112],
      orbToReadoutsPx: [0, 8],
      titleToShortcutsPx: [8, 14],
      'timeline.height': [170, 310],
      sectionsHeightAtRootPx: [0, 0],
      secondarySelfOverlaps: [0, 0],
      secondaryOverlapsCore: [0, 0],
      pickerOutsideRowPx: [-40, 0],
      rowTallerThanPlayPx: [0, 1],
      pickerOverlapsTransport: [0, 0],
      leftInsetPx: [0, 400],
      // The stacked row's first wrapped line runs a few px wider than the inset track at 390; an
      // un-inset row would overhang by a whole gutter (~50px).
      rightInsetPx: [-6, 400],
      sectionCollisions: [0, 0],
      secondaryCollisions: [0, 0],
      crumbsRendered: [2, 10],
      feedTagWidthPx: [0, 1],
      'browse.width': [44, 64],
      'browse.height': [44, 64],
      browseOverlapsCard: [0, 0],
      browseOffscreenPx: [-390, 0],
      eventSheetWidthPx: [PHONE_FLOOR_VIEWPORT.width - 10, PHONE_FLOOR_VIEWPORT.width],
      eventSheetOverlapsTimeline: [0, 0],
      'tour.ringToPlayOffsetPx': [0, 2],
      'tour.cardOverlapsRing': [0, 0],
      'tour.cardOffscreenPx': [-844, -8],
      'tour.skip.width': [44, 200],
      'tour.skip.height': [44, 90],
      'tour.cardContent.width': [160, 400],
      'tour.cardContent.height': [80, 500],
    },
  },
  {
    name: 'phone-orb-touch-tap',
    description:
      "Phone portrait 390x844, touch: a finger tap on the minimised orb's centre expands the globe and does nothing " +
      'else — t and the section unchanged, so the tap never also lands on the era shortcut the expanded layout puts ' +
      'under the finger.',
    viewport: PHONE_FLOOR_VIEWPORT,
    touch: true,
    t: 0,
    // In `actions`, so the screenshot shows the result of the tap.
    actions: async ({ page, hook }) => {
      const orb = await boxOf(page, GLOBE_EXPAND_SELECTOR)
      phoneOrbTapBefore = await hook.getState()
      await touchTap(page, centreX(orb), centreY(orb))
      await rafTicks(page, 3)
    },
    measure: async ({ hook }) => {
      const before = phoneOrbTapBefore
      const after = await hook.getState()
      return {
        expanded: after.globeExpanded ? 1 : 0,
        sectionUnchanged: after.sectionId === before.sectionId ? 1 : 0,
        tDeltaYears: after.t - before.t,
      }
    },
    expect: { expanded: [1, 1], sectionUnchanged: [1, 1], tDeltaYears: [0, 0] },
  },
  {
    name: 'layout-844x390-resting',
    description:
      'Short landscape 844x390 (ADR-048), collapsed: the drawn orb ≥ 29% and portrait ≥ 25% of the height; no chrome ' +
      'region (title, each era shortcut, orb, ancestor column, caption label, feed strip, timeline) overlaps another or ' +
      'leaves the viewport, at the root and in a section; title centred (±3px); caption ≥ 4px above the playhead ' +
      'label and on the feed row (±3px, ≥ 8px apart); the breadcrumb row takes no height at the root and sits above ' +
      'the track in a section; the mode/scale/volume controls on one row (±2px), each ≥ 32px, clear of transport and ' +
      'track; no band label clipped; the caption shows its title alone, its ⓘ opening a description panel on screen; ' +
      "a jump to a scene whose full image is held draws that scene's thumbnail (the canvas ≥ 10% changed, mean luma ≥ 20).",
    viewport: LANDSCAPE_VIEWPORT,
    t: 0,
    measure: async ({ page, hook }) => {
      const viewport = LANDSCAPE_VIEWPORT
      const regionBoxes = async () => {
        const shortcuts = await allRects(page, `${ERA_SHORTCUTS_SELECTOR} button`)
        const b = await boxesOf(page, {
          title: TIME_TITLE_SELECTOR,
          orb: GLOBE_EXPAND_SELECTOR,
          about: ABOUT_BUTTON_SELECTOR,
          portrait: ANCESTOR_PORTRAIT_SELECTOR,
          readout: ANCESTOR_READOUT_SELECTOR,
          feed: EVENT_FEED_ITEM_SELECTOR,
          timeline: BOTTOM_CHROME_SELECTOR,
          label: PLAYHEAD_LABEL_SELECTOR,
        })
        const caption = await captionLabelBox(page)
        const regions = {
          title: b.title,
          dinosaurs: shortcuts[0],
          humans: shortcuts[1],
          orb: b.orb,
          ancestor: unionBox([b.about, b.portrait, b.readout]),
          caption,
          feed: b.feed,
          timeline: b.timeline,
        }
        return { regions, label: b.label }
      }
      const bandsClipped = () =>
        page.evaluate(() => {
          const strip = document.querySelector('[data-section-bands]')
          if (strip === null) return -1
          const stripRect = strip.getBoundingClientRect()
          const clipped = [...strip.querySelectorAll('li span')].filter((label) => {
            const rect = label.getBoundingClientRect()
            return label.scrollWidth > label.clientWidth + 0.5 || rect.right > stripRect.right + 0.5 || rect.left < stripRect.left - 0.5
          })
          return clipped.length + (strip.scrollWidth > strip.clientWidth + 1 ? 1 : 0)
        })

      const orb = await minimisedOrbDrawnBounds(page)
      const portrait = await opacityMatteBounds(page, await boxOf(page, ANCESTOR_PORTRAIT_SELECTOR))
      const root = await regionBoxes()
      const sectionsHeightAtRootPx = (await hiddenBoxOf(page, TIMELINE_CONTROLS_SECTIONS_SELECTOR)).height
      const captionTextVisible = (await page.locator(SCENE_CAPTION_TEXT_SELECTOR).first().isVisible()) ? 1 : 0
      const clippedBandsAtRoot = await bandsClipped()
      // No other shot visits 450 Ma, so its full image is not already cached.
      const thumbnail = await heldFullImageDraw(page, hook, { image: 'scenes/ordovician-reef-shore.webp', t: 450e6, restoreT: 0 })

      await page.locator(SCENE_CAPTION_BUTTON_SELECTOR).first().click()
      await rafTicks(page, 2)
      const detailOverflowPx = viewportOverflowPx(await boxOf(page, SCENE_CAPTION_DETAIL_SELECTOR), viewport)
      await page.keyboard.press('Escape')
      await rafTicks(page, 2)
      const detailClosed = (await page.locator(SCENE_CAPTION_DETAIL_SELECTOR).count()) === 0 ? 1 : 0
      await page.mouse.move(0, 0)

      await selectSection(page, hook, 'cenozoic')
      const inSection = await regionBoxes()
      const b = await boxesOf(page, { nav: BREADCRUMB_SELECTOR, track: TIMELINE_TRACK_STACK_SELECTOR, core: TIMELINE_CONTROLS_CORE_SELECTOR })
      const parts = await boxesOf(page, {
        mode: `${TIMELINE_CONTROLS_SECONDARY_SELECTOR} [role="group"]:not([class*="scaleOptions"])`,
        scale: `${TIMELINE_CONTROLS_SECONDARY_SELECTOR} [class*="scaleOptions"]`,
        sound: '[data-testid="timeline-sound-slot"]',
      })
      const centres = Object.values(parts).map(centreY)
      const clippedBandsInSection = await bandsClipped()
      const { regions } = root
      return {
        orbDrawnDiameterPx: orb.height,
        portraitDrawnDiameterPx: portrait.height,
        root: layoutFlags(regions, viewport),
        inSection: layoutFlags(inSection.regions, viewport),
        titleCentreOffsetPx: centreX(regions.title) - viewport.width / 2,
        captionToLabelGapPx: Math.min(root.label.y - (regions.caption.y + regions.caption.height), inSection.label.y - (inSection.regions.caption.y + inSection.regions.caption.height)),
        captionFeedRowOffsetPx: Math.abs(centreY(regions.caption) - centreY(regions.feed)),
        feedToCaptionGapPx: regions.caption.x - (regions.feed.x + regions.feed.width),
        sectionsHeightAtRootPx,
        breadcrumbAboveTrackPx: b.track.y - (b.nav.y + b.nav.height),
        secondaryOverflowPx: Math.max(...Object.values(parts).map((box) => viewportOverflowPx(box, viewport))),
        secondaryMinHeightPx: Math.min(...Object.values(parts).map((box) => box.height)),
        secondaryCentreSpreadPx: Math.max(...centres) - Math.min(...centres),
        secondaryOverlapsTransport: Object.values(parts).some((box) => rectsOverlap(box, b.core)) ? 1 : 0,
        secondaryOverlapsTrack: Object.values(parts).some((box) => rectsOverlap(box, b.track)) ? 1 : 0,
        clippedBands: Math.max(clippedBandsAtRoot, clippedBandsInSection),
        captionTextVisible,
        detailOverflowPx,
        detailClosed,
        thumbnail,
      }
    },
    expect: {
      orbDrawnDiameterPx: [Math.round(LANDSCAPE_VIEWPORT.height * 0.29), 400],
      portraitDrawnDiameterPx: [Math.round(LANDSCAPE_VIEWPORT.height * 0.25), 400],
      ...prefixedLayoutExpect('root', ['title', 'dinosaurs', 'humans', 'orb', 'ancestor', 'caption', 'feed', 'timeline']),
      ...prefixedLayoutExpect('inSection', ['title', 'dinosaurs', 'humans', 'orb', 'ancestor', 'caption', 'feed', 'timeline']),
      titleCentreOffsetPx: [-3, 3],
      captionToLabelGapPx: [4, 400],
      captionFeedRowOffsetPx: [0, 3],
      feedToCaptionGapPx: [8, 800],
      sectionsHeightAtRootPx: [0, 0],
      breadcrumbAboveTrackPx: [0, 20],
      secondaryOverflowPx: [-400, 0],
      secondaryMinHeightPx: [32, 60],
      secondaryCentreSpreadPx: [0, 2],
      secondaryOverlapsTransport: [0, 0],
      secondaryOverlapsTrack: [0, 0],
      clippedBands: [0, 0],
      captionTextVisible: [0, 0],
      detailOverflowPx: [-400, 0],
      detailClosed: [1, 1],
      'thumbnail.heldRequests': [1, 10],
      'thumbnail.changePct': [10, 100],
      'thumbnail.meanLuma': [20, 255],
    },
  },
  desktopExpandedShot(DEFAULT_VIEWPORT, { sphereWidth: [470, 515], mapWidth: [960, 1030], withMap: true }),
  desktopExpandedShot(NARROW_DESKTOP_VIEWPORT),
  {
    name: 'layout-390x844-expanded',
    description:
      'Phone portrait 390x844, globe expanded: the drawn sphere 330-400px across; no region (title, era shortcuts, ' +
      'overlay control, close, Globe/Map toggle, zoom, feed strip, timeline, drawn sphere) overlaps another or leaves ' +
      'the viewport; row 2 (shortcuts, 24-36px overlay control, one centre line ±6px) ≥ 4px clear of the sphere; toggle ' +
      'and zoom, equal heights (±1px), 4-200px below it; the feed strip ≥ 4px below the sphere and 2-60px above the ' +
      'timeline. In map mode row 2 stays ≥ 4px clear of the drawn map.',
    viewport: PHONE_FLOOR_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    measure: async ({ page, hook }) => {
      const sphere = await globeBodyBounds(page, GLOBE_SPHERE_FIT_FRAME_SELECTOR)
      const b = await boxesOf(page, {
        title: TIME_TITLE_SELECTOR,
        era: ERA_SHORTCUTS_SELECTOR,
        close: CLOSE_BUTTON_SELECTOR,
        toggle: VIEW_MODE_TOGGLE_SELECTOR,
        zoom: ZOOM_CONTROLS_SELECTOR,
        feed: SHELL_FEED_SELECTOR,
        timeline: BOTTOM_CHROME_SELECTOR,
      })
      const overlayControl = await overlayControlBox(page)
      const sphereBottom = sphere.y + sphere.height
      await switchGlobeViewMode(page, hook, 'map')
      const map = await globeBodyBounds(page, GLOBE_MAP_FIT_FRAME_SELECTOR)
      return {
        sphere,
        layout: layoutFlags({ ...b, overlay: overlayControl, sphere }, PHONE_FLOOR_VIEWPORT),
        eraClearanceGapPx: rectClearancePx(b.era, sphere),
        overlayClearanceGapPx: rectClearancePx(overlayControl, sphere),
        overlayControlHeightPx: overlayControl.height,
        // The two sit in separate subtrees, each centred in a shared band, and differ in height.
        rowAlignmentDeltaPx: Math.abs(centreY(b.era) - centreY(overlayControl)),
        toggleClearanceGapPx: b.toggle.y - sphereBottom,
        zoomClearanceGapPx: b.zoom.y - sphereBottom,
        toggleHeightMinusZoomPx: b.toggle.height - b.zoom.height,
        feedBelowSphereGapPx: b.feed.y - sphereBottom,
        timelineBelowFeedGapPx: b.timeline.y - (b.feed.y + b.feed.height),
        mapEraClearanceGapPx: rectClearancePx(await boxOf(page, ERA_SHORTCUTS_SELECTOR), map),
        mapOverlayClearanceGapPx: rectClearancePx(await overlayControlBox(page), map),
      }
    },
    expect: {
      'sphere.width': [330, 400],
      'sphere.height': [330, 400],
      ...prefixedLayoutExpect('layout', ['title', 'era', 'close', 'toggle', 'zoom', 'feed', 'timeline', 'overlay', 'sphere']),
      eraClearanceGapPx: [4, 400],
      overlayClearanceGapPx: [4, 400],
      overlayControlHeightPx: [24, 36],
      rowAlignmentDeltaPx: [0, 6],
      toggleClearanceGapPx: [4, 200],
      zoomClearanceGapPx: [4, 200],
      toggleHeightMinusZoomPx: [-1, 1],
      feedBelowSphereGapPx: [4, 400],
      timelineBelowFeedGapPx: [2, 60],
      mapEraClearanceGapPx: [4, 400],
      mapOverlayClearanceGapPx: [4, 400],
    },
  },
  {
    name: 'layout-844x390-expanded',
    description:
      'Short landscape 844x390, globe expanded, inside a section: a left column (title, era shortcuts, overlay, ' +
      'Globe/Map toggle, zoom) and the drawn shape right of it and above the timeline, nothing overlapping another ' +
      'or the timeline; the drawn sphere with its glow at least the height above the timeline less 16px (4px tolerance), the drawn ' +
      "map filling the box right of the column to within 15%; the crumb trail directly above the transport, clear " +
      'of it and of the shape.',
    viewport: LANDSCAPE_VIEWPORT,
    t: 0,
    state: { globeExpanded: true, globeViewMode: 'globe' },
    actions: async ({ page, hook }) => selectSection(page, hook, 'mesozoic'),
    measure: async ({ page, hook }) => {
      const columnSelectors = {
        title: TIME_TITLE_SELECTOR,
        era: ERA_SHORTCUTS_SELECTOR,
        overlay: OVERLAY_SELECT_STACK_SELECTOR,
        toggle: VIEW_MODE_TOGGLE_SELECTOR,
        zoom: ZOOM_CONTROLS_SELECTOR,
      }
      const measureShape = async () => {
        const b = await boxesOf(page, { ...columnSelectors, timeline: BOTTOM_CHROME_SELECTOR, close: CLOSE_BUTTON_SELECTOR, crumbs: BREADCRUMB_SELECTOR, core: TIMELINE_CONTROLS_CORE_SELECTOR })
        const columnRight = Math.max(...Object.keys(columnSelectors).map((name) => b[name].x + b[name].width))
        // Everything but the globe canvas hidden, so the shape is found wherever it lands. The
        // threshold keeps the atmosphere glow's bright inner edge: the fit frame leaves the glow
        // its room, so "as large as the height allows" is sphere plus glow.
        const restore = await hideAllButGlobeCanvas(page, [...Object.values(columnSelectors), CLOSE_BUTTON_SELECTOR])
        await rafTicks(page, 2)
        const shape = await drawnBoundsInClip(page, { x: 0, y: 0, width: LANDSCAPE_VIEWPORT.width, height: LANDSCAPE_VIEWPORT.height }, { threshold: SPHERE_OVER_GLOW_THRESHOLD })
        await restore()
        const { timeline, close, crumbs, core, ...column } = b
        return {
          shape,
          layout: pairwiseOverlapFlags({ ...column, shape, timeline, close, crumbs }),
          shapeRightOfColumnPx: shape.x - columnRight,
          shapeAboveTimelinePx: timeline.y - (shape.y + shape.height),
          sphereDeficitPx: timeline.y - 16 - shape.height,
          mapFillFraction: Math.max(shape.height / (timeline.y - 16), shape.width / (close.x - 8 - (columnRight + 12))),
          crumbsAboveCoreGapPx: core.y - (crumbs.y + crumbs.height),
          crumbsOverlapCore: rectsOverlap(crumbs, core) ? 1 : 0,
        }
      }
      const sphere = await measureShape()
      await switchGlobeViewMode(page, hook, 'map')
      const map = await measureShape()
      return { sphere, map }
    },
    expect: Object.fromEntries(
      ['sphere', 'map'].flatMap((mode) => [
        [`${mode}.shape.width`, [100, 2000]],
        ...Object.entries(noPairOverlaps(['title', 'era', 'overlay', 'toggle', 'zoom', 'shape', 'timeline', 'close', 'crumbs'])).map(([key, range]) => [`${mode}.layout.${key}`, range]),
        [`${mode}.shapeRightOfColumnPx`, [0, 400]],
        [`${mode}.shapeAboveTimelinePx`, [0, 400]],
        mode === 'sphere' ? [`${mode}.sphereDeficitPx`, [-400, 4]] : [`${mode}.mapFillFraction`, [0.85, 1.05]],
        [`${mode}.crumbsAboveCoreGapPx`, [0, 200]],
        [`${mode}.crumbsOverlapCore`, [0, 0]],
      ]),
    ),
  },
  {
    name: 'globe-interactions',
    description:
      'Pointer hit-testing against the real canvas geometry, at 50 ka: a click on the minimised orb expands the ' +
      'globe; a click on an arrival the human layer draws (found by its "Click for details" hover hint) opens its ' +
      'event\'s detail panel with a Route section, its surface opaque and ending ≥ 16px above the viewport bottom; one "Zoom in" press grows the drawn sphere by ≥ 80px; a click on ' +
      'the sphere keeps the view open; a real click reaches the "Map" button (nothing covers it); a click on the map ' +
      'keeps the view open; back on the sphere, a click on the empty backdrop closes it. The arrival click runs ' +
      'only in the full run, not under --smoke.',
    viewport: DEFAULT_VIEWPORT,
    t: 50_000,
    measure: async ({ page, hook, smoke }) => {
      // Two frames for the click to land, then whether the globe is still expanded — one round trip.
      const expandedAfterClick = async (x, y) => {
        await page.mouse.click(x, y)
        return page.evaluate(async () => {
          for (let i = 0; i < 2; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve))
          return window.__earthlapse.getState().globeExpanded ? 1 : 0
        })
      }
      const reduced = await motionReduced(page)
      // A plain click on the orb (its canvas; the expand button beneath is the keyboard path).
      const { orb } = await boxesOf(page, { orb: GLOBE_EXPAND_SELECTOR })
      const orbClickExpands = await expandedAfterClick(centreX(orb), centreY(orb))
      await hook.ready()
      await waitForGlobeFitFramesStable(page)
      const frames = await boxesOf(page, { sphere: GLOBE_SPHERE_FIT_FRAME_SELECTOR, map: GLOBE_MAP_FIT_FRAME_SELECTOR })

      // At 50 ka the Asian and Sahul arrivals are on the sphere. Hover spread samples of what the
      // human layer draws until one shows the "Click for details" hint, then click it. The hover
      // hunt is most of this shot's time, so `--smoke` leaves it to the full run.
      let arrival = null
      if (!smoke) {
        await page.mouse.move(0, 0)
        const points = await humanLayerPoints(page, hook)
        for (const [x, y] of points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 12)) === 0).slice(0, 12)) {
          await page.mouse.move(x, y)
          await rafTicks(page, 2)
          if ((await page.locator(GLOBE_TOOLTIP_HINT_SELECTOR).count()) > 0) {
            arrival = [x, y]
            break
          }
        }
      }
      let arrivalOpensRoute = 0
      let arrivalPanelBottomInsetPx = null
      let arrivalPanelSurfaceAlpha = null
      if (arrival !== null) {
        await page.mouse.click(...arrival)
        await rafTicks(page, 3)
        await hook.ready()
        // One round trip: each one waits out a software-rendered frame of the expanded globe.
        const panel = await page.evaluate(() => {
          const dialog = [...document.querySelectorAll('[role="dialog"]')].find((el) =>
            [...el.querySelectorAll('h3')].some((heading) => heading.textContent?.trim() === 'Route'),
          )
          if (dialog === undefined) return null
          const alpha = getComputedStyle(dialog).backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\)/)
          return { bottom: dialog.getBoundingClientRect().bottom, alpha: alpha === null ? 1 : Number(alpha[1]) }
        })
        const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Route' }) })
        if (panel !== null) {
          arrivalOpensRoute = 1
          arrivalPanelBottomInsetPx = DEFAULT_VIEWPORT.height - panel.bottom
          arrivalPanelSurfaceAlpha = panel.alpha
        }
        await page.keyboard.press('Escape')
        await detail.waitFor({ state: 'detached', timeout: 5_000 })
      }
      await page.mouse.move(0, 0)

      const restore = await hideAroundSphereStrip(page)
      const strip = () => drawnBoundsInClip(page, GLOBE_CHROME_FREE_STRIP, { threshold: SPHERE_OVER_GLOW_THRESHOLD })
      const defaultWidth = (await strip()).width
      await pressZoomIn(page, 1)
      const zoomedWidth = (await strip()).width
      await restore()

      const sphereClickKeepsOpen = await expandedAfterClick(centreX(frames.sphere), centreY(frames.sphere))
      // A real click, so hit-testing and `pointer-events` apply: a covered button fails
      // Playwright's actionability check outright (`hook.setGlobeViewMode` would not).
      await page.locator(VIEW_MODE_TOGGLE_SELECTOR).getByRole('button', { name: 'Map' }).click()
      if (!reduced) await waitForApproxUnfoldProgress(page, 1)
      await waitForGlobeFitFramesStable(page)
      const mapClickKeepsOpen = await expandedAfterClick(centreX(frames.map), centreY(frames.map))
      await hook.setGlobeViewMode('globe')
      if (!reduced) await waitForApproxUnfoldProgress(page, 1)
      await waitForGlobeFitFramesStable(page)
      // Left of the sphere, below the legend, above the timeline.
      const expandedAfterBackdropClick = await expandedAfterClick(150, 700)

      return {
        orbClickExpands,
        defaultWidth,
        zoomGrowthPx: zoomedWidth - defaultWidth,
        sphereClickKeepsOpen,
        mapClickKeepsOpen,
        expandedAfterBackdropClick,
        arrivalFound: arrival === null ? 0 : 1,
        arrivalOpensRoute,
        arrivalPanelBottomInsetPx,
        arrivalPanelSurfaceAlpha,
      }
    },
    expect: ({ smoke }) => ({
      orbClickExpands: [1, 1],
      zoomGrowthPx: [80, 800],
      sphereClickKeepsOpen: [1, 1],
      mapClickKeepsOpen: [1, 1],
      expandedAfterBackdropClick: [0, 0],
      ...(smoke
        ? {}
        : {
            arrivalFound: [1, 1],
            arrivalOpensRoute: [1, 1],
            // The backdrop's own gutter at least: a panel ending flush with the viewport clips its border.
            arrivalPanelBottomInsetPx: [16, 900],
            arrivalPanelSurfaceAlpha: [1, 1],
          }),
    }),
  },
]
