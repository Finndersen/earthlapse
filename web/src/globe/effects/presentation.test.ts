// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnchorUv } from './overlays'
import { MIN_EFFECT_TRANSITION_SECONDS, nextHeldAnchor, usePresentedGlobeEffectUniforms } from './presentation'
import type { GlobeEffectUniforms } from './resolve'

const ANCHOR: AnchorUv = { u: 0.3, v: 0.6 }
const OTHER_ANCHOR: AnchorUv = { u: 0.8, v: 0.1 }

const INERT: GlobeEffectUniforms = {
  regimeWeights: { magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 },
  iceShell: 0,
  impactWinterVeil: 0,
  impactFlash: 0,
  impactFlashAnchorUv: null,
  giantImpactFlash: 0,
}

function withFlash(intensity: number, anchor: AnchorUv | null): GlobeEffectUniforms {
  return { ...INERT, impactFlash: intensity, impactFlashAnchorUv: anchor }
}

describe('nextHeldAnchor', () => {
  it('follows a non-null target regardless of current or stillNeeded', () => {
    expect(nextHeldAnchor(null, ANCHOR, false)).toBe(ANCHOR)
    expect(nextHeldAnchor(OTHER_ANCHOR, ANCHOR, true)).toBe(ANCHOR)
  })

  it('keeps the current anchor when the target goes null but it is still needed', () => {
    expect(nextHeldAnchor(ANCHOR, null, true)).toBe(ANCHOR)
  })

  it('clears to null once the target is null and it is no longer needed', () => {
    expect(nextHeldAnchor(ANCHOR, null, false)).toBeNull()
  })

  it('stays null when nothing was ever active', () => {
    expect(nextHeldAnchor(null, null, false)).toBeNull()
    expect(nextHeldAnchor(null, null, true)).toBeNull()
  })
})

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

// How a target moving slower than the floor is followed exactly is asserted on
// `stepNumericRecord` in lib/presentedMix.test.ts; these cover what this hook adds on top.
describe('usePresentedGlobeEffectUniforms', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts at the target exactly, with no catch-up on the first frame', () => {
    const { result } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), { initialProps: { target: INERT } })
    expect(result.current).toEqual(INERT)
  })

  it('rate-limits a jump in every intensity field, never completing in under the floor', () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), {
      initialProps: { target: INERT },
    })

    const target: GlobeEffectUniforms = {
      regimeWeights: { magmaOcean: 1, waterWorld: 0, archean: 0, unknownGeography: 0 },
      iceShell: 1,
      impactWinterVeil: 0,
      impactFlash: 0,
      impactFlashAnchorUv: null,
      giantImpactFlash: 0,
    }
    act(() => rerender({ target }))

    advance(200)
    expect(result.current.iceShell).toBeGreaterThan(0)
    expect(result.current.iceShell).toBeLessThan(1)
    expect(result.current.regimeWeights.magmaOcean).toBeGreaterThan(0)
    expect(result.current.regimeWeights.magmaOcean).toBeLessThan(1)

    advance(MIN_EFFECT_TRANSITION_SECONDS * 1000 - 250)
    expect(result.current).not.toEqual(target)
    advance(200)
    expect(result.current).toEqual(target)
  })

  it('holds the last anchor while the presented flash is still decaying past the raw target going null', () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), {
      initialProps: { target: withFlash(1, ANCHOR) },
    })
    expect(result.current.impactFlashAnchorUv).toBe(ANCHOR)

    // A scrub jumps straight past the effect: the raw target is inert (no anchor) again, but
    // the presented flash has not caught up to 0 yet.
    act(() => rerender({ target: INERT }))
    advance(100)
    expect(result.current.impactFlash).toBeGreaterThan(0)
    expect(result.current.impactFlashAnchorUv).toEqual(ANCHOR)

    advance(MIN_EFFECT_TRANSITION_SECONDS * 1000 + 100)
    expect(result.current.impactFlash).toBe(0)
    expect(result.current.impactFlashAnchorUv).toBeNull()
  })
})
