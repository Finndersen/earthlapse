/**
 * Per-scene crop (ADR-045, ADR-047). Both renderers show a scene's still "cover"-fitted to the
 * viewport — crop, never letterbox — and a scene's optional `framing.focus` decides where along
 * the cropped axis that window sits: centred on the focus, clamped so it never leaves the image.
 * In a portrait viewport `framing.portraitZoom` also shrinks the window in both dimensions, which
 * leaves room along the other axis too, so there `focus` positions it both ways. Absent framing
 * is a centred, unzoomed crop.
 *
 * Every quantity here is a fraction of the image's own width/height, origin top-left, y down —
 * the same frame `Scene.framing.focus` is authored in — unless it says it is relative to a box.
 */

import type { SceneFraming } from '@/types/manifest'

import type { DriftUniforms } from './drift'

/** A point in an image as fractions of its width and height, origin top-left, y down. */
export type ImagePoint = readonly [x: number, y: number]

/** The part of an image a viewport shows, as fractions of the image, origin top-left. */
export interface CoverWindow {
  x: number
  y: number
  width: number
  height: number
}

/** How one scene's still is cropped: the point the window centres on, and how far a portrait
 *  viewport's window is zoomed in (1 = the plain cover fit). */
export interface SceneCrop {
  focus: ImagePoint
  portraitZoom: number
}

export const CENTRED_FOCUS: ImagePoint = [0.5, 0.5]

export const CENTRED_CROP: SceneCrop = { focus: CENTRED_FOCUS, portraitZoom: 1 }

/** The crop a scene's framing describes; a scene without framing crops centred and unzoomed. */
export function sceneCrop(framing: SceneFraming | undefined): SceneCrop {
  if (framing === undefined) return CENTRED_CROP
  return { focus: framing.focus, portraitZoom: framing.portraitZoom ?? 1 }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The window of an image (aspect `imageAspect` = width / height) that a viewport of aspect
 * `viewportAspect` shows under a cover fit centred on `crop.focus`. A viewport narrower than the
 * image keeps the full height and a `viewportAspect / imageAspect`-wide band of the width; a wider
 * one keeps the full width and an `imageAspect / viewportAspect`-tall band of the height. A
 * portrait viewport (aspect < 1) then divides both spans by `crop.portraitZoom`. Each axis is
 * centred on the focus and clamped inside the image; an axis the window spans fully has only one
 * position, so the focus moves the window only along an axis it does not fill.
 */
export function coverWindow(imageAspect: number, viewportAspect: number, crop: SceneCrop): CoverWindow {
  if (!(imageAspect > 0) || !(viewportAspect > 0)) {
    throw new RangeError(`coverWindow needs positive aspects, got image ${imageAspect}, viewport ${viewportAspect}`)
  }
  if (!(crop.portraitZoom >= 1)) {
    throw new RangeError(`coverWindow needs a portrait zoom of at least 1, got ${crop.portraitZoom}`)
  }
  const zoom = viewportAspect < 1 ? crop.portraitZoom : 1
  const narrower = imageAspect > viewportAspect
  const width = (narrower ? viewportAspect / imageAspect : 1) / zoom
  const height = (narrower ? 1 : imageAspect / viewportAspect) / zoom
  const centreX = clamp(crop.focus[0], width / 2, 1 - width / 2)
  const centreY = clamp(crop.focus[1], height / 2, 1 - height / 2)
  return { x: centreX - width / 2, y: centreY - height / 2, width, height }
}

/** `inner` expressed as fractions of `outer`, which must contain it. */
export function windowWithin(outer: CoverWindow, inner: CoverWindow): CoverWindow {
  return {
    x: (inner.x - outer.x) / outer.width,
    y: (inner.y - outer.y) / outer.height,
    width: inner.width / outer.width,
    height: inner.height / outer.height,
  }
}

/** The CSS `object-position` that makes `object-fit: cover` show exactly `window`. A percentage
 *  `p` aligns the point `p` of the way across the image with the point `p` across the box, so
 *  the window's leading edge sits at `p * (1 - span)` of the image. */
export function coverObjectPosition(window: CoverWindow): string {
  const along = (start: number, span: number): number => (span < 1 ? start / (1 - span) : 0.5)
  const percent = (fraction: number): number => Number((fraction * 100).toFixed(4))
  return `${percent(along(window.x, window.width))}% ${percent(along(window.y, window.height))}%`
}

/** The window covering the whole of whatever it is measured against. */
export const FULL_WINDOW: CoverWindow = { x: 0, y: 0, width: 1, height: 1 }

/** The styles that make an `object-fit: cover` element show a crop window under a drift. */
export interface CoverCss {
  objectPosition: string
  transform: string
}

/**
 * `object-fit: cover` can only show the unzoomed cover window, so `objectPosition` places that and
 * `transform` (about the box centre) scales the zoomed window up to fill the box, then applies the
 * drift inside it — the same mapping `shaders.ts`'s `sceneUV` samples.
 */
export function coverCss(imageAspect: number, boxAspect: number, crop: SceneCrop, drift: DriftUniforms): CoverCss {
  const cover = coverWindow(imageAspect, boxAspect, { focus: crop.focus, portraitZoom: 1 })
  const zoomed = coverWindow(imageAspect, boxAspect, crop)
  const unzoomed = zoomed.width === cover.width && zoomed.height === cover.height
  return {
    objectPosition: coverObjectPosition(cover),
    transform: coverTransform(drift, unzoomed ? FULL_WINDOW : windowWithin(cover, zoomed)),
  }
}

/** The CSS transform, about the box centre, that fills the box with `inset` (fractions of the
 *  box) and then drifts within it; the drift is in fractions of that window. */
export function coverTransform({ zoom, dx, dy }: DriftUniforms, inset: CoverWindow): string {
  const drift = `scale(${zoom}) translate(${-dx * 100}%, ${-dy * 100}%)`
  if (inset === FULL_WINDOW) return drift
  const fill = `translate(-50%, -50%) scale(${1 / inset.width}, ${1 / inset.height})`
  return `${drift} ${fill} translate(${(0.5 - inset.x) * 100}%, ${(0.5 - inset.y) * 100}%)`
}
