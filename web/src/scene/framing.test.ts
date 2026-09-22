import { describe, expect, it } from 'vitest'

import { CENTRED_FOCUS, coverObjectPosition, coverWindow } from './framing'

const STILL_ASPECT = 2752 / 1536
const PHONE_PORTRAIT = 390 / 844
const TABLET_PORTRAIT = 768 / 1024
const ULTRAWIDE = 21 / 9

describe('coverWindow', () => {
  it('shows the full height and a viewport-wide band of a still on a phone in portrait', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, CENTRED_FOCUS)
    const width = PHONE_PORTRAIT / STILL_ASPECT
    expect(width * 2752).toBeCloseTo(710, 0)
    expect(window).toEqual({ x: 0.5 - width / 2, y: 0, width, height: 1 })
  })

  it('centres the window on a focus that leaves room on both sides', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, [0.3, 0.9])
    expect(window.x + window.width / 2).toBeCloseTo(0.3)
    expect(window.y).toBe(0)
    expect(window.height).toBe(1)
  })

  it('clamps at the left edge rather than showing past it', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, [0.02, 0.5])
    expect(window.x).toBe(0)
    expect(window.width).toBeCloseTo(PHONE_PORTRAIT / STILL_ASPECT)
  })

  it('clamps at the right edge rather than showing past it', () => {
    const window = coverWindow(STILL_ASPECT, TABLET_PORTRAIT, [1, 0.5])
    expect(window.x + window.width).toBeCloseTo(1)
    expect(window.width).toBeCloseTo(TABLET_PORTRAIT / STILL_ASPECT)
  })

  it('keeps the full width and moves a height band to the focus when the viewport is wider', () => {
    const height = STILL_ASPECT / ULTRAWIDE
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, [0.1, 0.5])).toEqual({ x: 0, y: 0.5 - height / 2, width: 1, height })
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, [0.1, 0]).y).toBe(0)
    expect(coverWindow(STILL_ASPECT, ULTRAWIDE, [0.1, 1]).y + height).toBeCloseTo(1)
  })

  it('shows the whole image when the aspects match, whatever the focus', () => {
    expect(coverWindow(STILL_ASPECT, STILL_ASPECT, [0, 1])).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('refuses a non-positive aspect', () => {
    expect(() => coverWindow(STILL_ASPECT, 0, CENTRED_FOCUS)).toThrow(RangeError)
    expect(() => coverWindow(Number.NaN, 1, CENTRED_FOCUS)).toThrow(RangeError)
  })
})

describe('coverObjectPosition', () => {
  it('is 50% 50% for a centred window', () => {
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, CENTRED_FOCUS))).toBe('50% 50%')
  })

  it('reaches 0% and 100% exactly at the clamped edges', () => {
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, [0, 0.5]))).toBe('0% 50%')
    expect(coverObjectPosition(coverWindow(STILL_ASPECT, PHONE_PORTRAIT, [1, 0.5]))).toBe('100% 50%')
  })

  it('reproduces the window: the box offset it implies lands the window at the left of the box', () => {
    const window = coverWindow(STILL_ASPECT, PHONE_PORTRAIT, [0.3, 0.5])
    const p = Number.parseFloat(coverObjectPosition(window)) / 100
    // Box width is the window's width in image units; object-position offsets the image by
    // p * (box - image), which must equal -window.x.
    expect(p * (window.width - 1)).toBeCloseTo(-window.x)
  })
})
