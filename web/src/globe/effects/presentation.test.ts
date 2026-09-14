import { act, renderHook, waitFor } from '@testing-library/react'
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

describe('usePresentedGlobeEffectUniforms', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts at the target exactly, with no catch-up on the first frame', () => {
    const { result } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), { initialProps: { target: INERT } })
    expect(result.current).toEqual(INERT)
  })

  it('rate-limits a jump in every intensity field, never completing in under the floor', async () => {
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
    const jumpedAt = performance.now()
    act(() => rerender({ target }))

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.current.iceShell).toBeGreaterThan(0)
    expect(result.current.iceShell).toBeLessThan(1)
    expect(result.current.regimeWeights.magmaOcean).toBeGreaterThan(0)
    expect(result.current.regimeWeights.magmaOcean).toBeLessThan(1)

    await waitFor(() => expect(result.current).toEqual(target), { timeout: 3000, interval: 20 })
    // A full 0 -> 1 change takes at least the floor of wall-clock time (a frame of slack).
    expect((performance.now() - jumpedAt) / 1000).toBeGreaterThanOrEqual(MIN_EFFECT_TRANSITION_SECONDS - 0.05)
  }, 10000)

  it('holds the last anchor while the presented flash is still decaying past the raw target going null', async () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), {
      initialProps: { target: withFlash(1, ANCHOR) },
    })
    expect(result.current.impactFlashAnchorUv).toBe(ANCHOR)

    // A scrub jumps straight past the effect: the raw target is inert (no anchor) again, but
    // the presented flash has not caught up to 0 yet.
    act(() => rerender({ target: INERT }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current.impactFlash).toBeGreaterThan(0)
    expect(result.current.impactFlashAnchorUv).toEqual(ANCHOR)

    await waitFor(() => expect(result.current.impactFlash).toBe(0), { timeout: 3000, interval: 20 })
    expect(result.current.impactFlashAnchorUv).toBeNull()
  }, 10000)

  it('follows the raw target immediately when it moves slower than the floor', async () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedGlobeEffectUniforms(target), {
      initialProps: { target: INERT },
    })
    // A slow scrub through the ease band: each step is small next to dt / minSeconds, so the
    // presented value should track it exactly rather than lag.
    for (let i = 1; i <= 5; i++) {
      const target: GlobeEffectUniforms = { ...INERT, iceShell: i * 0.02 }
      act(() => rerender({ target }))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(result.current.iceShell).toBeCloseTo(target.iceShell, 2)
    }
  }, 10000)
})
