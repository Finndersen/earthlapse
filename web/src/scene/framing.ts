/**
 * Per-scene crop (ADR-045). Both renderers show a scene's still "cover"-fitted to the
 * viewport — crop, never letterbox — and a scene's optional `framing.focus` decides where along
 * the cropped axis that window sits: centred on the focus, clamped so it never leaves the image.
 * Absent framing is a centred crop.
 *
 * Every quantity here is a fraction of the image's own width/height, origin top-left, y down —
 * the same frame `Scene.framing.focus` is authored in.
 */

/** A point in an image as fractions of its width and height, origin top-left, y down. */
export type ImagePoint = readonly [x: number, y: number]

/** The part of an image a viewport shows, as fractions of the image, origin top-left. */
export interface CoverWindow {
  x: number
  y: number
  width: number
  height: number
}

export const CENTRED_FOCUS: ImagePoint = [0.5, 0.5]

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The window of an image (aspect `imageAspect` = width / height) that a viewport of aspect
 * `viewportAspect` shows under a cover fit centred on `focus`. A viewport narrower than the image
 * keeps the full height and a `viewportAspect / imageAspect`-wide band of the width; a wider one
 * keeps the full width and an `imageAspect / viewportAspect`-tall band of the height.
 */
export function coverWindow(imageAspect: number, viewportAspect: number, focus: ImagePoint): CoverWindow {
  if (!(imageAspect > 0) || !(viewportAspect > 0)) {
    throw new RangeError(`coverWindow needs positive aspects, got image ${imageAspect}, viewport ${viewportAspect}`)
  }
  if (imageAspect > viewportAspect) {
    const width = viewportAspect / imageAspect
    const centre = clamp(focus[0], width / 2, 1 - width / 2)
    return { x: centre - width / 2, y: 0, width, height: 1 }
  }
  const height = imageAspect / viewportAspect
  const centre = clamp(focus[1], height / 2, 1 - height / 2)
  return { x: 0, y: centre - height / 2, width: 1, height }
}

/** The CSS `object-position` that makes `object-fit: cover` show exactly `window`. A percentage
 *  `p` aligns the point `p` of the way across the image with the point `p` across the box, so
 *  the window's leading edge sits at `p * (1 - span)` of the image. */
export function coverObjectPosition(window: CoverWindow): string {
  const along = (start: number, span: number): number => (span < 1 ? start / (1 - span) : 0.5)
  const percent = (fraction: number): number => Number((fraction * 100).toFixed(4))
  return `${percent(along(window.x, window.width))}% ${percent(along(window.y, window.height))}%`
}
