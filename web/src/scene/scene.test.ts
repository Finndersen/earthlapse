import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { captionOpacity, DISSOLVE_WIDTH, dominantScene, resolveAssetUrl, sceneAt } from './scene'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
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

/** Inverts sceneAt's log1p interpolation to pick a `t` landing at a known `p` in [a, b]. */
function tAtP(a: number, b: number, p: number): number {
  return Math.expm1(Math.log1p(a) + (Math.log1p(b) - Math.log1p(a)) * p)
}

// -------------------------------------------------------------------------- exact scene t

describe('sceneAt at an exact scene time', () => {
  it.each([s0, s1, s2, s3])('returns $id alone, mix 0', (s) => {
    expect(sceneAt(scenes, s.t)).toEqual({ from: s, to: s, mix: 0 })
  })
})

// ---------------------------------------------------------------------------- out of range

describe('sceneAt outside the scene domain', () => {
  it('clamps to the newest scene before it', () => {
    expect(sceneAt(scenes, -50)).toEqual({ from: s0, to: s0, mix: 0 })
  })

  it('clamps to the oldest scene after it', () => {
    expect(sceneAt(scenes, 1e6)).toEqual({ from: s3, to: s3, mix: 0 })
  })
})

// ------------------------------------------------------------------------- hold, then dissolve

const halfWidth = DISSOLVE_WIDTH / 2

describe('sceneAt: held clear outside the DISSOLVE_WIDTH band around the midpoint', () => {
  it('is mix 0 well before the midpoint', () => {
    const t = tAtP(s0.t, s1.t, 0.2)
    expect(sceneAt(scenes, t)).toEqual({ from: s0, to: s1, mix: 0 })
  })

  it('is still mix 0 just outside the band', () => {
    const t = tAtP(s0.t, s1.t, 0.5 - halfWidth - 0.01)
    expect(sceneAt(scenes, t).mix).toBe(0)
  })

  it('is mix 1 well after the midpoint', () => {
    const t = tAtP(s2.t, s3.t, 0.8)
    expect(sceneAt(scenes, t)).toEqual({ from: s2, to: s3, mix: 1 })
  })

  it('is already mix 1 just outside the band on the other side', () => {
    const t = tAtP(s0.t, s1.t, 0.5 + halfWidth + 0.01)
    expect(sceneAt(scenes, t).mix).toBe(1)
  })
})

describe('sceneAt: rising only within the DISSOLVE_WIDTH band', () => {
  it('is exactly 0.5 at the interpolation midpoint (smoothstep is symmetric)', () => {
    const t = tAtP(s1.t, s2.t, 0.5)
    const result = sceneAt(scenes, t)
    expect(result.from).toBe(s1)
    expect(result.to).toBe(s2)
    expect(result.mix).toBeCloseTo(0.5)
  })

  it('is strictly between 0 and 1 just inside the band on either side', () => {
    const before = sceneAt(scenes, tAtP(s0.t, s1.t, 0.5 - halfWidth / 2)).mix
    const after = sceneAt(scenes, tAtP(s0.t, s1.t, 0.5 + halfWidth / 2)).mix
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(1)
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(1)
  })
})

// --------------------------------------------------------------- continuity / monotonicity

describe('mix across a gap', () => {
  it('is continuous and monotone non-decreasing in t', () => {
    const mixes = Array.from({ length: 49 }, (_, i) => {
      const p = 0.02 + (i / 48) * 0.96
      return sceneAt(scenes, tAtP(s1.t, s2.t, p)).mix
    })
    // Sanity bound on the step between adjacent samples, not a precise number: with 49
    // samples over p in [0.02, 0.98] (step ~0.02) and the smoothstep's steepest point (slope
    // 1.5 / DISSOLVE_WIDTH in p) landing exactly on a sample at p = 0.5, the true max step is
    // ~0.208 — comfortably below "jumps by half the mix range in one sample" (0.5), which is
    // what this guards against; it is not meant to pin DISSOLVE_WIDTH's exact value.
    for (let i = 1; i < mixes.length; i++) {
      expect(mixes[i]!).toBeGreaterThanOrEqual(mixes[i - 1]!)
      expect(mixes[i]! - mixes[i - 1]!).toBeLessThan(0.25)
    }
  })

  it('holds at 0 or 1 for most of the gap — the dissolve is a narrow band, not the whole span', () => {
    const mixes = Array.from({ length: 49 }, (_, i) => {
      const p = 0.02 + (i / 48) * 0.96
      return sceneAt(scenes, tAtP(s0.t, s1.t, p)).mix
    })
    const heldCount = mixes.filter((m) => m === 0 || m === 1).length
    expect(heldCount / mixes.length).toBeGreaterThan(0.5)
  })
})

// ------------------------------------------------------------------------------- edge cases

describe('sceneAt edge cases', () => {
  it('throws on an empty scene list', () => {
    expect(() => sceneAt([], 0)).toThrow(/no scenes/)
  })

  it('returns the single scene alone for any t when there is only one', () => {
    expect(sceneAt([s1], -1e9)).toEqual({ from: s1, to: s1, mix: 0 })
    expect(sceneAt([s1], s1.t)).toEqual({ from: s1, to: s1, mix: 0 })
    expect(sceneAt([s1], 1e9)).toEqual({ from: s1, to: s1, mix: 0 })
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

// ------------------------------------------------------------------------- captionOpacity

describe('captionOpacity', () => {
  it('is 1 at either end of the dissolve (mix 0 or 1)', () => {
    expect(captionOpacity(0)).toBe(1)
    expect(captionOpacity(1)).toBe(1)
  })

  it('dips to exactly 0 right at the switch point, mix 0.5', () => {
    expect(captionOpacity(0.5)).toBe(0)
  })

  it('is symmetric around mix 0.5', () => {
    expect(captionOpacity(0.3)).toBeCloseTo(captionOpacity(0.7))
    expect(captionOpacity(0.1)).toBeCloseTo(captionOpacity(0.9))
  })

  it('falls monotonically from mix 0 to 0.5, then rises monotonically from 0.5 to 1', () => {
    expect(captionOpacity(0.1)).toBeGreaterThan(captionOpacity(0.3))
    expect(captionOpacity(0.3)).toBeGreaterThan(captionOpacity(0.5))
    expect(captionOpacity(0.5)).toBeLessThan(captionOpacity(0.7))
    expect(captionOpacity(0.7)).toBeLessThan(captionOpacity(0.9))
  })

  it('is a pure function of mix alone', () => {
    expect(captionOpacity(0.42)).toBe(captionOpacity(0.42))
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
