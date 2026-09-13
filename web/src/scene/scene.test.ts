import { describe, expect, it } from 'vitest'

import type { Chapter, Scene } from '@/types/manifest'

import { dominantScene, resolveAssetUrl, sceneAt } from './scene'

// Four scenes across two chapters: s0-s1 and s2-s3 are within-chapter intervals, s1-s2
// straddles the 'late' -> 'early' boundary.
function scene(id: string, t: number, chapterId: string): Scene {
  return {
    id,
    t,
    chapterId,
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0, 'late')
const s1 = scene('s1', 100, 'late')
const s2 = scene('s2', 200, 'early')
const s3 = scene('s3', 400, 'early')
const scenes: Scene[] = [s0, s1, s2, s3]

const chapters: Chapter[] = [
  { id: 'late', label: 'Late', tStart: 0, tEnd: 150 },
  { id: 'early', label: 'Early', tStart: 150, tEnd: 500 },
]

/** Inverts sceneAt's log1p interpolation to pick a `t` landing at a known `p` in [a, b]. */
function tAtP(a: number, b: number, p: number): number {
  return Math.expm1(Math.log1p(a) + (Math.log1p(b) - Math.log1p(a)) * p)
}

// -------------------------------------------------------------------------- exact scene t

describe('sceneAt at an exact scene time', () => {
  it.each([s0, s1, s2, s3])('returns $id alone, mix 0', (s) => {
    expect(sceneAt(scenes, chapters, s.t)).toEqual({ from: s, to: s, mix: 0 })
  })
})

// ---------------------------------------------------------------------------- out of range

describe('sceneAt outside the scene domain', () => {
  it('clamps to the newest scene before it', () => {
    expect(sceneAt(scenes, chapters, -50)).toEqual({ from: s0, to: s0, mix: 0 })
  })

  it('clamps to the oldest scene after it', () => {
    expect(sceneAt(scenes, chapters, 1e6)).toEqual({ from: s3, to: s3, mix: 0 })
  })
})

// ------------------------------------------------------------------------- within a chapter

describe('sceneAt within a chapter (wide window)', () => {
  it('holds the newer scene before the window opens', () => {
    const t = tAtP(s0.t, s1.t, 0.1)
    expect(sceneAt(scenes, chapters, t)).toEqual({ from: s0, to: s1, mix: 0 })
  })

  it('is exactly 0.5 at the interpolation midpoint (smoothstep is symmetric)', () => {
    const t = tAtP(s0.t, s1.t, 0.5)
    const result = sceneAt(scenes, chapters, t)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s1)
    expect(result.mix).toBeCloseTo(0.5)
  })

  it('holds the older scene after the window closes', () => {
    const t = tAtP(s2.t, s3.t, 0.9)
    expect(sceneAt(scenes, chapters, t)).toEqual({ from: s2, to: s3, mix: 1 })
  })

  it('has already started dissolving at p=0.35, inside the 0.3..0.7 window', () => {
    const t = tAtP(s0.t, s1.t, 0.35)
    const mix = sceneAt(scenes, chapters, t).mix
    expect(mix).toBeGreaterThan(0)
    expect(mix).toBeLessThan(0.5)
  })
})

// ---------------------------------------------------------------------- across a boundary

describe('sceneAt across a chapter boundary (narrow window)', () => {
  it('is still fully held at p=0.35, outside the narrower 0.45..0.55 window', () => {
    const t = tAtP(s1.t, s2.t, 0.35)
    expect(sceneAt(scenes, chapters, t)).toEqual({ from: s1, to: s2, mix: 0 })
  })

  it('reads as a near-cut: mix swings from 0 to 1 over a narrow band around the midpoint', () => {
    const before = sceneAt(scenes, chapters, tAtP(s1.t, s2.t, 0.4)).mix
    const after = sceneAt(scenes, chapters, tAtP(s1.t, s2.t, 0.6)).mix
    expect(before).toBe(0)
    expect(after).toBe(1)
  })

  it('is exactly 0.5 at the interpolation midpoint', () => {
    const t = tAtP(s1.t, s2.t, 0.5)
    expect(sceneAt(scenes, chapters, t).mix).toBeCloseTo(0.5)
  })
})

// same p, different chapter membership -> different dissolve progress
describe('the boundary window is narrower than the within-chapter window', () => {
  it('at the same relative position p, a within-chapter pair has started dissolving while a cross-boundary pair has not', () => {
    const withinMix = sceneAt(scenes, chapters, tAtP(s0.t, s1.t, 0.35)).mix
    const acrossMix = sceneAt(scenes, chapters, tAtP(s1.t, s2.t, 0.35)).mix
    expect(withinMix).toBeGreaterThan(acrossMix)
  })
})

// --------------------------------------------------------------- continuity / monotonicity

describe('mix across an interval', () => {
  it('is continuous and monotone non-decreasing in t (within-chapter)', () => {
    const mixes = Array.from({ length: 49 }, (_, i) => {
      const p = 0.02 + (i / 48) * 0.96
      return sceneAt(scenes, chapters, tAtP(s0.t, s1.t, p)).mix
    })
    for (let i = 1; i < mixes.length; i++) {
      expect(mixes[i]!).toBeGreaterThanOrEqual(mixes[i - 1]!)
      expect(mixes[i]! - mixes[i - 1]!).toBeLessThan(0.15)
    }
  })

  it('is continuous and monotone non-decreasing in t (cross-boundary)', () => {
    const mixes = Array.from({ length: 49 }, (_, i) => {
      const p = 0.02 + (i / 48) * 0.96
      return sceneAt(scenes, chapters, tAtP(s1.t, s2.t, p)).mix
    })
    for (let i = 1; i < mixes.length; i++) {
      expect(mixes[i]!).toBeGreaterThanOrEqual(mixes[i - 1]!)
    }
  })
})

// ------------------------------------------------------------------------------- edge cases

describe('sceneAt edge cases', () => {
  it('throws on an empty scene list', () => {
    expect(() => sceneAt([], chapters, 0)).toThrow(/no scenes/)
  })

  it('returns the single scene alone for any t when there is only one', () => {
    expect(sceneAt([s1], chapters, -1e9)).toEqual({ from: s1, to: s1, mix: 0 })
    expect(sceneAt([s1], chapters, s1.t)).toEqual({ from: s1, to: s1, mix: 0 })
    expect(sceneAt([s1], chapters, 1e9)).toEqual({ from: s1, to: s1, mix: 0 })
  })

  it('throws when a scene references a chapter absent from the manifest', () => {
    const ghost = scene('ghost', 50, 'nonexistent')
    expect(() => sceneAt([s0, ghost, s1], chapters, tAtP(0, 50, 0.5))).toThrow(/unknown chapter/)
  })
})

// -------------------------------------------------------------------------- dominantScene

describe('dominantScene', () => {
  it('is `from` while mix is below 0.5', () => {
    expect(dominantScene({ from: s0, to: s1, mix: 0.2 })).toBe(s0)
  })

  it('is `to` once mix reaches 0.5', () => {
    expect(dominantScene({ from: s0, to: s1, mix: 0.5 })).toBe(s1)
    expect(dominantScene({ from: s0, to: s1, mix: 0.9 })).toBe(s1)
  })
})

// ------------------------------------------------------------------------- resolveAssetUrl

describe('resolveAssetUrl', () => {
  it('joins a relative path onto the asset base', () => {
    expect(resolveAssetUrl('https://cdn.example.com/build-1', 'images/s0.png')).toBe(
      'https://cdn.example.com/build-1/images/s0.png',
    )
  })

  it('normalises a missing or doubled slash at the join', () => {
    expect(resolveAssetUrl('https://cdn.example.com/build-1/', '/images/s0.png')).toBe(
      'https://cdn.example.com/build-1/images/s0.png',
    )
  })

  it('leaves an already-absolute URL untouched', () => {
    expect(resolveAssetUrl('https://cdn.example.com/build-1', 'https://other.example.com/s0.png')).toBe(
      'https://other.example.com/s0.png',
    )
  })
})
