import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { driftAt, REST_DRIFT } from './drift'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    thumbnail: `${id}-thumb.png`,
    shot: 'WIDE_RIDGE',
    title: `title ${id}`,
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 200)
const s3 = scene('s3', 400)
const scenes: Scene[] = [s0, s1, s2, s3]

function logMidpointT(a: number, b: number): number {
  return Math.expm1((Math.log1p(a) + Math.log1p(b)) / 2)
}

const [spanStart, spanEnd] = [logMidpointT(s0.t, s1.t), logMidpointT(s1.t, s2.t)]

function framed(id: string, t: number, pan: number, portraitZoom?: number): Scene {
  return { ...scene(id, t), framing: { focus: [0.5, 0.5], pan, ...(portraitZoom ? { portraitZoom } : {}) } }
}

describe('driftAt', () => {
  it('is pure in (scenes, index, t), independent of call order', () => {
    const a = driftAt(scenes, 1, 150)
    driftAt(scenes, 3, 350)
    expect(driftAt(scenes, 1, 150)).toEqual(a)
  })

  it('keeps zoom within [1, 1.05] and the pan inside the crop margin at every t', () => {
    const list = [s0, framed('f', s1.t, 225), s2, s3]
    for (const t of [0, 50, 100, 150, 200, 300, 400, 1e9]) {
      for (const sc of [scenes, list]) {
        for (let i = 0; i < sc.length; i++) {
          const { zoom, dx, dy } = driftAt(sc, i, t)
          expect(zoom).toBeGreaterThanOrEqual(1)
          expect(zoom).toBeLessThanOrEqual(1.05)
          expect(Math.hypot(dx, dy)).toBeLessThanOrEqual((zoom - 1) / 2 + 1e-9)
        }
      }
    }
  })

  it('rests at zoom 1 with no pan before the push-in, and for a single scene', () => {
    expect(driftAt(scenes, 3, s3.t + 1)).toEqual(REST_DRIFT)
    expect(driftAt([s1], 0, -1e9)).toEqual(REST_DRIFT)
    expect(REST_DRIFT).toEqual({ zoom: 1, dx: 0, dy: 0 })
  })

  it('pushes in smoothly and monotonically from zoom 1 to 1.05 across the hold span', () => {
    expect(driftAt(scenes, 1, spanEnd).zoom).toBeCloseTo(1)
    expect(driftAt(scenes, 1, spanStart).zoom).toBeCloseTo(1.05)
    const zooms = Array.from({ length: 21 }, (_, i) => driftAt(scenes, 1, spanEnd - ((spanEnd - spanStart) * i) / 20).zoom)
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]! - 1e-9)
      expect(zooms[i]! - zooms[i - 1]!).toBeLessThan(0.01)
    }
  })

  it.each([
    [0, 1, 0],
    [90, 0, 1],
    [180, -1, 0],
  ])('pans toward the edge named by %d degrees', (pan, sx, sy) => {
    const { dx, dy } = driftAt([s0, framed('f', s1.t, pan), s2, s3], 1, spanStart)
    expect(dx / Math.hypot(dx, dy)).toBeCloseTo(sx)
    expect(dy / Math.hypot(dx, dy)).toBeCloseTo(sy)
  })

  it('pans the same distance with or without framing, whatever the portrait zoom', () => {
    const plain = driftAt(scenes, 1, spanStart)
    const withPan = driftAt([s0, framed('s1', s1.t, 45), s2, s3], 1, spanStart)
    expect(Math.hypot(withPan.dx, withPan.dy)).toBeCloseTo(Math.hypot(plain.dx, plain.dy))
    expect(driftAt([s0, framed('s1', s1.t, 45, 1.5), s2, s3], 1, spanStart)).toEqual(withPan)
  })
})
