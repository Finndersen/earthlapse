import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { captionOpacity, DISSOLVE_WIDTH, dominantScene, resolveAssetUrl, sceneAt } from './scene'

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

/** Inverts sceneAt's log1p interpolation to pick a t at a known fraction p of [a, b]. */
function tAtP(a: number, b: number, p: number): number {
  return Math.expm1(Math.log1p(a) + (Math.log1p(b) - Math.log1p(a)) * p)
}

const halfWidth = DISSOLVE_WIDTH / 2

describe('sceneAt', () => {
  it('returns a scene alone at its own t, clamping outside the domain', () => {
    for (const s of scenes) expect(sceneAt(scenes, s.t)).toEqual({ from: s, to: s, mix: 0 })
    expect(sceneAt(scenes, -50)).toEqual({ from: s0, to: s0, mix: 0 })
    expect(sceneAt(scenes, 1e6)).toEqual({ from: s3, to: s3, mix: 0 })
    expect(sceneAt([s1], 1e9)).toEqual({ from: s1, to: s1, mix: 0 })
    expect(() => sceneAt([], 0)).toThrow(/no scenes/)
  })

  it('holds each gap at mix 0 or 1 outside the dissolve band around its log midpoint', () => {
    expect(sceneAt(scenes, tAtP(s0.t, s1.t, 0.2))).toEqual({ from: s0, to: s1, mix: 0 })
    expect(sceneAt(scenes, tAtP(s0.t, s1.t, 0.5 - halfWidth - 0.01)).mix).toBe(0)
    expect(sceneAt(scenes, tAtP(s0.t, s1.t, 0.5 + halfWidth + 0.01)).mix).toBe(1)
    expect(sceneAt(scenes, tAtP(s1.t, s2.t, 0.5)).mix).toBeCloseTo(0.5)
    const inside = sceneAt(scenes, tAtP(s0.t, s1.t, 0.5 - halfWidth / 2)).mix
    expect(inside).toBeGreaterThan(0)
    expect(inside).toBeLessThan(1)
  })

  it('rises continuously and monotonically across a gap', () => {
    const mixes = Array.from({ length: 49 }, (_, i) => sceneAt(scenes, tAtP(s1.t, s2.t, 0.02 + (i / 48) * 0.96)).mix)
    for (let i = 1; i < mixes.length; i++) {
      expect(mixes[i]!).toBeGreaterThanOrEqual(mixes[i - 1]!)
      expect(mixes[i]! - mixes[i - 1]!).toBeLessThan(0.25)
    }
    expect(mixes.filter((m) => m === 0 || m === 1).length / mixes.length).toBeGreaterThan(0.5)
  })
})

describe('dominantScene / captionOpacity', () => {
  it('switches dominance at mix 0.5', () => {
    expect(dominantScene({ from: s0, to: s1, mix: 0.49 })).toBe(s0)
    expect(dominantScene({ from: s0, to: s1, mix: 0.5 })).toBe(s1)
  })

  it('dips the caption symmetrically to 0 exactly at the switch', () => {
    expect(captionOpacity(0)).toBe(1)
    expect(captionOpacity(1)).toBe(1)
    expect(captionOpacity(0.5)).toBe(0)
    expect(captionOpacity(0.3)).toBeCloseTo(captionOpacity(0.7))
    expect(captionOpacity(0.1)).toBeGreaterThan(captionOpacity(0.3))
  })
})

describe('resolveAssetUrl', () => {
  it('joins paths onto the base with one slash, leaving absolute URLs alone', () => {
    expect(resolveAssetUrl('https://cdn.example.com/b', 'images/s0.png')).toBe('https://cdn.example.com/b/images/s0.png')
    expect(resolveAssetUrl('https://cdn.example.com/b/', '/images/s0.png')).toBe('https://cdn.example.com/b/images/s0.png')
    expect(resolveAssetUrl('https://cdn.example.com/b', 'https://other.example.com/s0.png')).toBe('https://other.example.com/s0.png')
  })
})
