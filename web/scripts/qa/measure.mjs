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

  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  if (clip.width === 0 || clip.height === 0) return { x: clip.x, y: clip.y, width: 0, height: 0, fractionOfViewport: 0 }

  const png = await page.screenshot({ clip })
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const local = await page.evaluate(scanDrawnPixels, { dataUrl, threshold })

  const viewport = page.viewportSize()
  const viewportArea = viewport === null ? 1 : viewport.width * viewport.height
  return {
    x: clip.x + local.x,
    y: clip.y + local.y,
    width: local.width,
    height: local.height,
    fractionOfViewport: (local.width * local.height) / viewportArea,
  }
}

/**
 * Runs inside the page (via `page.evaluate`) — must be self-contained, no closures over
 * `measure.mjs`'s own module scope.
 * @param {{ dataUrl: string, threshold: number }} args
 * @returns {Promise<PixelBox>} bounds relative to the screenshot itself, `width`/`height` both 0
 *   when no pixel differs from the sampled background by more than `threshold`.
 */
async function scanDrawnPixels({ dataUrl, threshold }) {
  const image = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('drawnBounds: failed to decode the probe screenshot'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('drawnBounds: 2D canvas context unavailable')
  ctx.drawImage(image, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const at = (x, y) => (y * width + x) * 4
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  const bg = [0, 0, 0, 0]
  for (const [cx, cy] of corners) {
    const i = at(cx, cy)
    bg[0] += data[i]
    bg[1] += data[i + 1]
    bg[2] += data[i + 2]
    bg[3] += data[i + 3]
  }
  bg[0] /= corners.length
  bg[1] /= corners.length
  bg[2] /= corners.length
  bg[3] /= corners.length

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
