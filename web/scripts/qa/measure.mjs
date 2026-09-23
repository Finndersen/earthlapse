/**
 * Pixel measurement primitives for the visual-QA harness. Every function here returns numbers
 * in device-independent (CSS) pixels — the harness always creates the browser context with
 * `deviceScaleFactor: 1` (see `run.mjs`), so a Playwright screenshot's pixel grid already equals
 * the page's CSS pixel grid and no further conversion is needed.
 *
 * `drawnBounds` is the one that actually answers "what did the user's eye land on" — it scans
 * real rendered pixels, not layout. `boxOf` answers a different, narrower question (the element's
 * CSS box) and is named to make sure nobody reaches for it expecting the former: measuring a
 * `<canvas>`'s CSS box tells you the box the app *asked* the canvas to fill, not what got drawn
 * inside it — conflating the two is exactly the regression this harness exists to catch (see
 * this package's README).
 */

/**
 * @typedef {{x: number, y: number, width: number, height: number}} PixelBox
 * @typedef {PixelBox & { fractionOfViewport: number }} DrawnBounds
 */

/**
 * The bounding box of the actually-drawn (non-background) pixels inside the first element
 * matching `selector`. Works for a `<canvas>` (WebGL or 2D) or any other element — it never
 * inspects the DOM/CSS, only a screenshot of the element's own box.
 *
 * Method: screenshot the element's box, hand the PNG back to the page as a data URL, draw it to
 * an offscreen 2D canvas, `getImageData`, sample the four corners as the background colour, and
 * find the bounding rect of pixels whose summed per-channel difference from that background
 * exceeds `threshold`. No npm dependency: the "give the page back its own screenshot" round trip
 * is what stands in for an image-diffing library.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {{ threshold?: number }} [options] `threshold` (default 24, summed across R+G+B+A) is
 *   how far a pixel must sit from the sampled background before it counts as "drawn" — high
 *   enough to ignore antialiasing/compression noise at a flat edge, low enough to catch a dim
 *   scene against a near-black backdrop.
 * @returns {Promise<DrawnBounds>} `x`/`y` are page-absolute; `width`/`height` are 0 when nothing
 *   in the element differs from its own background (e.g. a canvas that never painted).
 */
export async function drawnBounds(page, selector, { threshold = 24 } = {}) {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`drawnBounds: "${selector}" has no box (display:none?)`)
  return drawnBoundsInClip(page, { x: box.x, y: box.y, width: box.width, height: box.height }, { threshold })
}

/**
 * `drawnBounds`'s own pixel scan, over an explicit page-absolute `clip` rectangle instead of a
 * selector's own bounding box. For the one case `drawnBounds` itself can't handle: an element
 * whose CSS box is deliberately much bigger than the region actually worth scanning — a
 * full-viewport `<canvas>` sitting behind unrelated chrome that also happens to fall inside that
 * box (`Globe.tsx`'s expanded `<canvas>`, `Globe.module.css`'s own doc comment on why it now fills
 * the whole backdrop) is exactly this: scanning the *element's* box would pick up the "Globe/Map"
 * toggle, the legend, the close button and the zoom controls as "drawn" pixels too, none of which
 * answer "how big is the sphere." Passing the known-clear centred sub-rectangle instead scopes the
 * scan to just the sphere and its immediate surroundings — no chrome, no elements to exclude by
 * name. `clip`'s coordinates are page-absolute CSS pixels, matching `boundingBox()`'s own.
 * @param {import('playwright').Page} page
 * @param {PixelBox} clip
 * @param {{ threshold?: number }} [options]
 * @returns {Promise<DrawnBounds>}
 */
export async function drawnBoundsInClip(page, clip, { threshold = 24 } = {}) {
  const roundedClip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) }
  if (roundedClip.width === 0 || roundedClip.height === 0) {
    return { x: roundedClip.x, y: roundedClip.y, width: 0, height: 0, fractionOfViewport: 0 }
  }

  const png = await page.screenshot({ clip: roundedClip })
  const local = await reducePixels(page, [png], scanDrawnPixels, { threshold })

  const viewport = page.viewportSize()
  const viewportArea = viewport === null ? 1 : viewport.width * viewport.height
  return {
    x: roundedClip.x + local.x,
    y: roundedClip.y + local.y,
    width: local.width,
    height: local.height,
    fractionOfViewport: (local.width * local.height) / viewportArea,
  }
}

/**
 * Decodes each PNG inside the page and hands their RGBA pixels (`ImageData`s, in order) to
 * `reducer`, returning whatever it returns — the one image decoder every pixel measurement in
 * this harness shares. The browser does the PNG decode, so the harness needs no npm image
 * library. `reducer` runs in the page from its source text, so it must be self-contained: no
 * closures over module scope, everything it needs passed in `args`.
 * @template T
 * @param {import('playwright').Page} page
 * @param {Buffer[]} pngs
 * @param {(images: ImageData[], args: any) => T} reducer
 * @param {unknown} [args]
 * @returns {Promise<T>}
 */
export function reducePixels(page, pngs, reducer, args = {}) {
  return page.evaluate(
    async ({ dataUrls, source, reducerArgs }) => {
      const decode = (src) =>
        new Promise((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () => reject(new Error('reducePixels: failed to decode a probe screenshot'))
          el.src = src
        })
      const images = []
      for (const image of await Promise.all(dataUrls.map(decode))) {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx === null) throw new Error('reducePixels: 2D canvas context unavailable')
        ctx.drawImage(image, 0, 0)
        images.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      }
      return new Function(`return (${source})`)()(images, reducerArgs)
    },
    { dataUrls: pngs.map((png) => `data:image/png;base64,${png.toString('base64')}`), source: reducer.toString(), reducerArgs: args },
  )
}

/**
 * `reducePixels` reducer: the bounding box of pixels whose summed RGBA difference from the
 * image's averaged four corners exceeds `threshold`, `width`/`height` 0 when none does.
 * @param {ImageData[]} images
 * @param {{ threshold: number }} args
 * @returns {PixelBox}
 */
function scanDrawnPixels([{ data, width, height }], { threshold }) {
  const at = (x, y) => (y * width + x) * 4
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  const bg = [0, 0, 0, 0]
  for (const [cx, cy] of corners) for (let c = 0; c < 4; c += 1) bg[c] += data[at(cx, cy) + c] / corners.length

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y)
      const diff =
        Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) + Math.abs(data[i + 3] - bg[3])
      if (diff > threshold) {
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

/**
 * The plain CSS box of the first element matching `selector` — `getBoundingClientRect`, nothing
 * more. See this module's own doc comment for why this must never stand in for `drawnBounds`.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<PixelBox>}
 */
export async function boxOf(page, selector) {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`boxOf: "${selector}" has no box (display:none?)`)
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/**
 * The plain layout box of the first element matching `selector`, read via a direct
 * `getBoundingClientRect()` rather than `locator.boundingBox()` — the latter first waits for
 * Playwright's "visible" actionability state, which a deliberately `visibility: hidden` element
 * (`Globe.tsx`'s `.orbFitFrameSphere`/`.orbFitFrameMap` — real geometry probes, never painted)
 * never reaches, so `boxOf`/`drawnBounds` can't target them at all. `visibility: hidden` still
 * lays out normally (unlike `display: none`), so this still returns a real box. Throws if the
 * element isn't in the DOM at all, the one case `getBoundingClientRect` can't distinguish from a
 * genuine zero-size box on its own.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<PixelBox>}
 */
export async function hiddenBoxOf(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, selector)
  if (box === null) throw new Error(`hiddenBoxOf: "${selector}" not found in the DOM`)
  return box
}

/**
 * Vertical free space between two elements' *drawn* content (not their CSS boxes) — positive
 * when they don't overlap, negative when they do (the magnitude of the overlap).
 * @param {import('playwright').Page} page
 * @param {string} selectorA
 * @param {string} selectorB
 * @param {{ threshold?: number }} [options]
 * @returns {Promise<number>}
 */
export async function gapBetween(page, selectorA, selectorB, options) {
  const [a, b] = await Promise.all([drawnBounds(page, selectorA, options), drawnBounds(page, selectorB, options)])
  const aBottom = a.y + a.height
  const bBottom = b.y + b.height
  if (aBottom <= b.y) return b.y - aBottom
  if (bBottom <= a.y) return a.y - bBottom
  return -(Math.min(aBottom, bBottom) - Math.max(a.y, b.y))
}
