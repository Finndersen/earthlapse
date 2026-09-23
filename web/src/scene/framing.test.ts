import { describe, expect, it } from 'vitest'

import {
  CENTRED_CROP,
  coverCss,
  coverObjectPosition,
  coverWindow,
  FULL_WINDOW,
  sceneCrop,
  windowWithin,
  type CoverWindow,
  type SceneCrop,
} from './framing'
import type { DriftUniforms } from './drift'
import { REST_DRIFT } from './drift'

const STILL_ASPECT = 2752 / 1536
const PHONE_PORTRAIT = 390 / 844
const TABLET_PORTRAIT = 768 / 1024
const ULTRAWIDE = 21 / 9

function at(focus: readonly [number, number], portraitZoom = 1): SceneCrop {
  return { focus, portraitZoom }
}

describe('coverWindow', () => {
  it('shows the full height and a viewport-wide band of a still on a phone in portrait', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, CENTRED_CROP)
    const width = PHONE_PORTRAIT / STILL_ASPECT
    expect(width * 2752).toBeCloseTo(710, 0)
    expect(window).toEqual({ x: 0.5 - width / 2, y: 0, width, height: 1 })
  })

  it('centres the window on a focus that leaves room on both sides', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.3, 0.9]))
    expect(window.x + window.width / 2).toBeCloseTo(0.3)
    expect(window.y).toBe(0)
    expect(window.height).toBe(1)
  })

  it('clamps at either edge rather than showing past it', () => {
    expect(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.02, 0.5])).x).toBe(0)
    const right = coverWindow(STILL_ASPECT, TABLET_PORTRAIT, at([1, 0.5]))
    expect(right.x + right.width).toBeCloseTo(1)
  })

  it('keeps the full width and moves a height band to the focus when the viewport is wider', () => {
    const height = STILL_ASPECT / ULTRAWIDE
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, at([0.1, 0.5]))).toEqual({ x: 0, y: 0.5 - height / 2, width: 1, height })
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, at([0.1, 0])).y).toBe(0)
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, at([0.1, 1])).y + height).toBeCloseTo(1)
  })

  it('shows the whole image when the aspects match, whatever the focus', () => {
    expect(coverWindow(STILL_ASPECT, STILL_ASPECT, at([0, 1]))).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('refuses a non-positive aspect', () => {
    expect(() => coverWindow(STILL_ASPECT, 0, CENTRED_CROP)).toThrow(RangeError)
    expect(() => coverWindow(Number.NaN, 1, CENTRED_CROP)).toThrow(RangeError)
  })
})

describe('coverObjectPosition', () => {
  it('is 50% 50% centred and 0%/100% at the clamped edges', () => {
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, CENTRED_CROP))).toBe('50% 50%')
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0, 0.5])))).toBe('0% 50%')
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([1, 0.5])))).toBe('100% 50%')
  })

  it('reproduces the window: the box offset it implies lands the window at the left of the box', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.3, 0.5]))
    const p = Number.parseFloat(coverObjectPosition(window)) / 100
    expect(p * (window.width - 1)).toBeCloseTo(-window.x)
  })
})

const DESKTOP = 1440 / 900

/** The plain cover crop, independent of portrait zoom. */
function unzoomedCoverWindow(imageAspect: number, viewportAspect: number, focus: readonly [number, number]): CoverWindow {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
  if (imageAspect > viewportAspect) {
    const width = viewportAspect / imageAspect
    const centre = clamp(focus[0], width / 2, 1 - width / 2)
    return { x: centre - width / 2, y: 0, width, height: 1 }
  }
  const height = imageAspect / viewportAspect
  const centre = clamp(focus[1], height / 2, 1 - height / 2)
  return { x: 0, y: centre - height / 2, width: 1, height }
}

describe('coverWindow with a portrait zoom', () => {
  it('shrinks a phone-portrait window by the zoom in both dimensions', () => {
    const width = PHONE_PORTRAIT / STILL_ASPECT / 1.4
    const height = 1 / 1.4
    expect(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0.5], 1.4))).toEqual({
      x: 0.5 - width / 2,
      y: 0.5 - height / 2,
      width,
      height,
    })
  })

  it('positions the window vertically on the focus, clamped inside the image', () => {
    const centred = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0.6], 1.25))
    expect(centred.y + centred.height / 2).toBeCloseTo(0.6)
    const low = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0.97], 1.25))
    expect(low.y + low.height).toBeCloseTo(1)
    const high = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0], 1.25))
    expect(high.y).toBe(0)
  })

  it.each([
    ['desktop', DESKTOP],
    ['same aspect as the still', STILL_ASPECT],
  ])('ignores the zoom in a %s viewport', (_, aspect) => {
    for (const focus of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.95]] as const) {
      expect(coverWindow(STILL_ASPECT, aspect, at(focus, 1.5))).toStrictEqual(unzoomedCoverWindow(STILL_ASPECT, aspect, focus))
    }
  })

  it.each([
    ['phone portrait', PHONE_PORTRAIT],
    ['ultrawide', ULTRAWIDE],
  ])('is exactly the plain cover window at zoom 1 in a %s viewport', (_, aspect) => {
    for (const focus of [[0, 0], [0.3, 0.7], [0.62, 0.55], [1, 1]] as const) {
      expect(coverWindow(STILL_ASPECT, aspect, at(focus))).toStrictEqual(unzoomedCoverWindow(STILL_ASPECT, aspect, focus))
    }
  })

  it('refuses a zoom below 1', () => {
    expect(() => coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0.5], 0.9))).toThrow(RangeError)
    expect(() => coverWindow(STILL_ASPECT, PHONE_PORTRAIT, at([0.5, 0.5], Number.NaN))).toThrow(RangeError)
  })
})

describe('sceneCrop', () => {
  it('defaults to the centred crop and an unzoomed portrait, carrying a zoom through', () => {
    expect(sceneCrop(undefined)).toBe(CENTRED_CROP)
    expect(sceneCrop({ focus: [0.2, 0.7], pan: 90 })).toEqual({ focus: [0.2, 0.7], portraitZoom: 1 })
    expect(sceneCrop({ focus: [0.2, 0.7], pan: 90, portraitZoom: 1.3 })).toEqual({ focus: [0.2, 0.7], portraitZoom: 1.3 })
  })
})

describe('windowWithin', () => {
  it('re-expresses a window as fractions of one containing it', () => {
    const outer = { x: 0.25, y: 0, width: 0.5, height: 1 }
    const inner = { x: 0.375, y: 0.25, width: 0.25, height: 0.5 }
    expect(windowWithin(outer, inner)).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    const window = { x: 0.2, y: 0.1, width: 0.4, height: 0.8 }
    expect(windowWithin(window, window)).toEqual(FULL_WINDOW)
  })
})

/** Applies a CSS `translate(%)`/`scale()` transform list about the box centre to a point in box
 *  fractions, per axis. */
function applyCssTransform(transform: string, point: readonly [number, number]): [number, number] {
  const ops = [...transform.matchAll(/(translate|scale)\(([^)]*)\)/g)].map(([, name, args]) => {
    const values = args!.split(',').map((a) => Number.parseFloat(a))
    const [x, y = name === 'scale' ? values[0]! : 0] = values
    return { name: name!, x: x!, y }
  })
  let [px, py] = [point[0] - 0.5, point[1] - 0.5]
  for (const op of ops.reverse()) {
    if (op.name === 'scale') {
      px *= op.x
      py *= op.y
    } else {
      px += op.x / 100
      py += op.y / 100
    }
  }
  return [px + 0.5, py + 0.5]
}

/** `shaders.ts`'s `sceneUV`, in y-down image fractions: the image point drawn at screen point `s`. */
function sceneUV(s: readonly [number, number], window: CoverWindow, drift: DriftUniforms): [number, number] {
  const local = (v: number, d: number): number => (v - 0.5) / drift.zoom + 0.5 + d
  return [window.x + local(s[0], drift.dx) * window.width, window.y + local(s[1], drift.dy) * window.height]
}

describe('coverCss', () => {
  const drift: DriftUniforms = { zoom: 1.04, dx: 0.008, dy: -0.006 }

  it('is the plain object-position and drift transform without a zoom', () => {
    const crop = at([0.3, 0.5])
    expect(coverCss(STILL_ASPECT, PHONE_PORTRAIT, crop, drift)).toEqual({
      objectPosition: coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, crop)),
      transform: `scale(1.04) translate(-0.8%, 0.6%)`,
    })
  })

  it('ignores a zoom in a landscape box', () => {
    expect(coverCss(STILL_ASPECT, DESKTOP, at([0.3, 0.5], 1.5), drift)).toEqual(
      coverCss(STILL_ASPECT, DESKTOP, at([0.3, 0.5]), drift),
    )
  })

  it.each([
    ['clamped to a corner', at([0.02, 0.98], 1.5), drift],
    ['at rest', at([0.6, 0.7], 1.2), REST_DRIFT],
  ])('draws the same image point at each screen point as the shader when %s', (_, crop, d) => {
    const { objectPosition, transform } = coverCss(STILL_ASPECT, PHONE_PORTRAIT, crop, d)
    const cover = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, { focus: crop.focus, portraitZoom: 1 })
    expect(objectPosition).toBe(coverObjectPosition(cover))
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, crop)
    for (const u of [
      [0, 0],
      [0.25, 0.8],
      [1, 1],
    ] as const) {
      // `u` is a point in the untransformed box, which shows `cover`; the transform moves it to
      // screen point `s`, where the shader would draw the same image point.
      const s = applyCssTransform(transform, u)
      const drawn = sceneUV(s, window, d)
      expect(drawn[0]).toBeCloseTo(cover.x + u[0] * cover.width, 10)
      expect(drawn[1]).toBeCloseTo(cover.y + u[1] * cover.height, 10)
    }
  })

  it('keeps a drifted, zoomed window inside the image', () => {
    const crop = at([0, 1], 1.5)
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, crop)
    const edgeward: DriftUniforms = { zoom: 1.05, dx: -0.015, dy: 0.015 }
    for (const s of [
      [0, 0],
      [1, 1],
    ] as const) {
      const [x, y] = sceneUV(s, window, edgeward)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })
})
