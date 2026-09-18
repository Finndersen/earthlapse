import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scene } from '@/types/manifest'

import { dominantScene, type PresentationRegime, type SceneMix } from './scene'
import { MIN_TRANSITION_SECONDS, step, usePresentedSceneMix } from './presentation'

/** Mirrors `presentation.ts`'s own (private, hand-mirrored) `MIN_CUT_DWELL_SECONDS` by value —
 *  the same "shared value, no import" convention its own doc comment explains. */
const MIN_CUT_DWELL_SECONDS = 0.35

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
const s4 = scene('s4', 800)

function alone(s: Scene): SceneMix {
  return { from: s, to: s, mix: 0 }
}

function dominantId(mix: SceneMix): string {
  return dominantScene(mix).id
}

// ------------------------------------------------------------------------- dt edge cases

describe('step: dt edge cases', () => {
  const state: SceneMix = { from: s0, to: s1, mix: 0.2 }
  const target: SceneMix = { from: s0, to: s1, mix: 0.9 }

  it.each([0, -1, NaN, Infinity, -Infinity])('returns state unchanged for dt = %p', (dt) => {
    expect(step(state, target, dt)).toBe(state)
  })
})

// ------------------------------------------------------------------------------ same pair

describe('step: same pair', () => {
  it('moves mix toward target.mix by at most dt / MIN_TRANSITION_SECONDS', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0 }
    const target: SceneMix = { from: s0, to: s1, mix: 1 }
    const dt = 0.1
    const result = step(state, target, dt)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s1)
    expect(result.mix).toBeCloseTo(dt / MIN_TRANSITION_SECONDS)
  })

  it('moves backward when target.mix is below the current mix', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0.5 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.1 }
    const result = step(state, target, 0.1)
    expect(result.mix).toBeLessThan(0.5)
    expect(result.mix).toBeGreaterThanOrEqual(0.1)
  })

  it('snaps exactly to target.mix rather than overshooting when the step is large', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.9 }
    const result = step(state, target, 100)
    expect(result.mix).toBe(0.9)
  })

  it('is a no-op once mix already equals target.mix', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0.4 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.4 }
    expect(step(state, target, 0.1)).toEqual(state)
  })
})

// -------------------------------------------------------------------------- reversed pair

describe('step: reversed pair', () => {
  it('relabels (to, from, m) as (from, to, 1 - m) before moving toward target.mix', () => {
    // state is mid-transition B -> A (from=s1, to=s0), which under target's own (s0, s1)
    // labelling reads as mix 1 - 0.3 = 0.7.
    const state: SceneMix = { from: s1, to: s0, mix: 0.3 }
    const target: SceneMix = { from: s0, to: s1, mix: 1 }
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s1)
    expect(result.mix).toBeCloseTo(0.7 + 0.1 / MIN_TRANSITION_SECONDS)
  })

  it('is already at target once relabelled, so a large dt snaps exactly', () => {
    const state: SceneMix = { from: s1, to: s0, mix: 0.5 } // relabels to 0.5 either way
    const target: SceneMix = { from: s0, to: s1, mix: 0.5 }
    const result = step(state, target, 100)
    expect(result).toEqual({ from: s0, to: s1, mix: 0.5 })
  })
})

// ---------------------------------------------------------------- different pair, settled

describe('step: different pair, settled, on-screen scene is in the target pair (rebase)', () => {
  it('rebases at the "from" end when the on-screen scene matches target.from', () => {
    // Settled showing s1 as the "to" of a (s0, s1) pair.
    const state: SceneMix = { from: s0, to: s1, mix: 1 }
    const target: SceneMix = { from: s1, to: s2, mix: 0.3 }
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s1)
    expect(result.to).toBe(s2)
    expect(result.mix).toBeCloseTo(0.1 / MIN_TRANSITION_SECONDS)
  })

  it('rebases at the "to" end when the on-screen scene matches target.to', () => {
    // Settled showing s1 as the "from" of a (s1, s2) pair.
    const state: SceneMix = { from: s1, to: s2, mix: 0 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.8 }
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s1)
    expect(result.mix).toBeCloseTo(1 - 0.1 / MIN_TRANSITION_SECONDS)
  })

  it('rebasing costs no wall-clock time of its own — a large dt reaches target.mix exactly', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 1 }
    const target: SceneMix = { from: s1, to: s2, mix: 0.3 }
    const result = step(state, target, 100)
    expect(result).toEqual({ from: s1, to: s2, mix: 0.3 })
  })
})

describe('step: different pair, settled, on-screen scene is unrelated (direct transition)', () => {
  it('starts a fresh transition straight from the on-screen scene to the target dominant scene', () => {
    const state = alone(s0)
    const target = alone(s3)
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s3)
    expect(result.mix).toBeCloseTo(0.1 / MIN_TRANSITION_SECONDS)
  })

  it('never introduces an intermediate scene as from/to while crossing several scenes', () => {
    const scenes = [s0, s1, s2, s3, s4]
    let state = alone(s0)
    const target = alone(s4)
    for (let i = 0; i < 500 && !(state.from === target.from && state.to === target.to && state.mix === target.mix); i++) {
      state = step(state, target, 0.05)
      expect(scenes.includes(state.from)).toBe(true)
      expect(scenes.includes(state.to)).toBe(true)
      // Only the original on-screen scene and the jump's destination ever appear as either
      // endpoint — nothing from the scenes lying between them (s1, s2, s3) is ever shown, and
      // once settled a rebase can legitimately collapse both endpoints onto the destination.
      expect(['s0', 's4']).toContain(state.from.id)
      expect(['s0', 's4']).toContain(state.to.id)
    }
    expect(state).toEqual(target)
  })
})

// ------------------------------------------------------------------- different pair, mid

describe('step: different pair, mid-transition', () => {
  it('keeps moving toward whichever end is nearer (log1p t) to the target dominant scene', () => {
    // Mid-transition s0 -> s3; target's dominant scene is s3 itself (nearer to `to`).
    const state: SceneMix = { from: s0, to: s3, mix: 0.4 }
    const target: SceneMix = { from: s3, to: s4, mix: 0.1 } // dominant = s3 (mix < 0.5)
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s3)
    expect(result.mix).toBeGreaterThan(0.4)
  })

  it('turns the transition around when the target dominant scene is nearer the other end', () => {
    // Mid-transition s1 -> s3; target's dominant scene is now s1 itself, i.e. exactly the
    // `from` endpoint — unambiguously nearer `from` than `to` regardless of log1p spacing.
    const state: SceneMix = { from: s1, to: s3, mix: 0.4 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.9 } // dominant = s1 (mix >= 0.5)
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s1)
    expect(result.to).toBe(s3)
    expect(result.mix).toBeLessThan(0.4)
  })

  it('does not change the pair endpoints while mid-transition, only mix', () => {
    const state: SceneMix = { from: s0, to: s3, mix: 0.4 }
    const target: SceneMix = { from: s2, to: s3, mix: 0.5 }
    const result = step(state, target, 0.1)
    expect(result.from).toBe(s0)
    expect(result.to).toBe(s3)
  })
})

// -------------------------------------------------------------------------- convergence

describe('step: convergence', () => {
  function runToConvergence(initial: SceneMix, target: SceneMix, dt: number, maxTicks = 1000): SceneMix {
    let state = initial
    for (let i = 0; i < maxTicks; i++) {
      if (state.from === target.from && state.to === target.to && state.mix === target.mix) return state
      state = step(state, target, dt)
    }
    throw new Error('did not converge within maxTicks')
  }

  it('a paused frame (repeated calls with the same target) stays exactly at target once reached', () => {
    const target: SceneMix = { from: s1, to: s2, mix: 0.6 }
    const settled = runToConvergence(alone(s0), target, 1 / 60)
    expect(settled).toEqual(target)
    // Further calls at the same target are pure no-ops.
    expect(step(settled, target, 1 / 60)).toEqual(target)
    expect(step(settled, target, 1 / 60)).toEqual(target)
  })

  it('converges exactly across a settle -> rebase -> settle chain (several scenes apart)', () => {
    const target: SceneMix = { from: s2, to: s3, mix: 0.5 }
    const settled = runToConvergence(alone(s0), target, 1 / 60)
    expect(settled).toEqual(target)
  })
})

// -------------------------------------------------------------------- min-duration guarantee

describe('step: MIN_TRANSITION_SECONDS is a hard floor', () => {
  it('a target that jumps mix 0 -> 1 instantly still takes >= MIN_TRANSITION_SECONDS of summed dt', () => {
    const target: SceneMix = { from: s0, to: s1, mix: 1 }
    let state: SceneMix = { from: s0, to: s1, mix: 0 }
    const dt = 1 / 60
    let elapsed = 0
    while (state.mix !== 1) {
      state = step(state, target, dt)
      elapsed += dt
    }
    expect(elapsed).toBeGreaterThanOrEqual(MIN_TRANSITION_SECONDS)
  })

  it('holds just as well for a direct transition across several scenes', () => {
    const target = alone(s4)
    let state = alone(s0)
    const dt = 1 / 60
    let elapsed = 0
    while (!(state.from === s4 && state.to === s4 && state.mix === 0)) {
      state = step(state, target, dt)
      elapsed += dt
    }
    expect(elapsed).toBeGreaterThanOrEqual(MIN_TRANSITION_SECONDS)
  })

  it('does not artificially slow down a target that is itself moving slower than the floor rate', () => {
    // A slow scrub: target.mix advances by 0.01 every 0.1s of real time (a full sweep would
    // take 10s, well over MIN_TRANSITION_SECONDS) — presented should simply track it exactly,
    // never lagging behind since it's never asked to move faster than its own rate limit.
    let state: SceneMix = { from: s0, to: s1, mix: 0 }
    for (let i = 1; i <= 100; i++) {
      const target: SceneMix = { from: s0, to: s1, mix: i * 0.01 }
      state = step(state, target, 0.1)
      expect(state.mix).toBeCloseTo(target.mix)
    }
  })
})

// -------------------------------------------------------------------------------- cut regime

describe('step: "cut" regime (ADR-029)', () => {
  it('snaps to the target dominant scene at mix 0/1 instantly, ignoring MIN_TRANSITION_SECONDS', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.6 }
    const result = step(state, target, 1 / 60, 'cut')
    expect(result).toEqual({ from: s0, to: s1, mix: 1 })
  })

  it('mix < 0.5 snaps to 0 (from), mix >= 0.5 snaps to 1 (to) — dominantScene\'s own tie-break', () => {
    const below: SceneMix = { from: s0, to: s1, mix: 0.49 }
    const atHalf: SceneMix = { from: s0, to: s1, mix: 0.5 }
    expect(step({ from: s0, to: s1, mix: 0 }, below, 1 / 60, 'cut').mix).toBe(0)
    expect(step({ from: s0, to: s1, mix: 0 }, atHalf, 1 / 60, 'cut').mix).toBe(1)
  })

  it('cuts straight to a distant target in one call — no gradual crossfade, no intermediate scenes', () => {
    const state = alone(s0)
    const target = alone(s4)
    const result = step(state, target, 1 / 60, 'cut')
    expect(result).toEqual({ from: s4, to: s4, mix: 0 })
  })

  it('is still a no-op for a non-positive/non-finite dt, same as crossfade', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0.2 }
    const target: SceneMix = { from: s0, to: s1, mix: 0.9 }
    expect(step(state, target, 0, 'cut')).toBe(state)
    expect(step(state, target, NaN, 'cut')).toBe(state)
  })

  it('defaults to "crossfade" when regime is omitted — every pre-ADR-029 call site unchanged', () => {
    const state: SceneMix = { from: s0, to: s1, mix: 0 }
    const target: SceneMix = { from: s0, to: s1, mix: 1 }
    const result = step(state, target, 0.1)
    expect(result.mix).toBeCloseTo(0.1 / MIN_TRANSITION_SECONDS)
  })
})

// -------------------------------------------------------------------------- MIN_TRANSITION_SECONDS

describe('MIN_TRANSITION_SECONDS', () => {
  it('is a positive, finite tunable', () => {
    expect(MIN_TRANSITION_SECONDS).toBeGreaterThan(0)
    expect(Number.isFinite(MIN_TRANSITION_SECONDS)).toBe(true)
  })
})

// ================================================================== usePresentedSceneMix

describe('usePresentedSceneMix', () => {
  beforeEach(() => {
    // jsdom has no requestAnimationFrame; stub it against real timers at ~60fps so the hook's
    // own dt accounting (which reads real elapsed wall-clock time) is meaningful.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts at target exactly — no animation on the first frame', () => {
    const target = alone(s0)
    const { result } = renderHook(() => usePresentedSceneMix(target))
    expect(result.current).toEqual(target)
  })

  it('catches up to a target that jumps to a distant scene, taking real wall-clock time to do it', async () => {
    const initialTarget = alone(s0)
    const { result, rerender } = renderHook(({ target }) => usePresentedSceneMix(target), {
      initialProps: { target: initialTarget as SceneMix },
    })
    expect(result.current).toEqual(initialTarget)

    const jumpedTarget = alone(s4)
    act(() => rerender({ target: jumpedTarget }))

    // Shortly after the jump, presentation must still be mid-transition — not already at the
    // far scene (the whole point of the minimum-duration floor).
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.current).not.toEqual(jumpedTarget)
    expect(result.current.from).toBe(s0)
    expect(result.current.to).toBe(s4)

    await waitFor(() => expect(result.current).toEqual(jumpedTarget), { timeout: 3000, interval: 50 })
  }, 10000)

  it('"cut" regime jumps straight to the binarized target — no multi-second catch-up', async () => {
    const initialTarget = alone(s0)
    const { result, rerender } = renderHook(({ target, regime }) => usePresentedSceneMix(target, regime), {
      initialProps: { target: initialTarget as SceneMix, regime: 'cut' as const },
    })
    expect(result.current).toEqual(initialTarget)

    const jumpedTarget: SceneMix = { from: s0, to: s4, mix: 0.9 }
    act(() => rerender({ target: jumpedTarget, regime: 'cut' }))

    await waitFor(() => expect(result.current).toEqual({ from: s0, to: s4, mix: 1 }), { timeout: 500, interval: 20 })
  })

  it('"cut" regime never displays a second dominant-scene change sooner than MIN_CUT_DWELL_SECONDS after the first (re-review fix, ADR-029/MEDIUM-1)', async () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedSceneMix(target, 'cut'), {
      initialProps: { target: alone(s0) as SceneMix },
    })

    // First change: unconstrained (nothing to rate-limit against yet).
    act(() => rerender({ target: alone(s1) }))
    await waitFor(() => expect(result.current).toEqual(alone(s1)), { interval: 10 })
    const firstChangeAt = performance.now()

    // A second change requested immediately after — real `requestAnimationFrame` jitter, or a
    // seek landing partway through an already-floored territory, can otherwise make this land
    // far under MIN_CUT_DWELL_SECONDS after the first.
    act(() => rerender({ target: alone(s2) }))

    // Held for a little while: still showing s1, not yet s2.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current).toEqual(alone(s1))

    await waitFor(() => expect(result.current).toEqual(alone(s2)), { timeout: 2000, interval: 10 })
    const secondChangeAt = performance.now()
    // Generous slack for test-harness/poll timing noise around the two waitFor resolutions —
    // still far stronger than "no gate at all" (which would pass at ~16-32ms).
    expect(secondChangeAt - firstChangeAt).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS * 1000 - 100)
  })

  it('"cut" regime does not hold back the very first dominant-scene change (nothing to rate-limit against yet)', async () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedSceneMix(target, 'cut'), {
      initialProps: { target: alone(s0) as SceneMix },
    })
    const mountedAt = performance.now()

    act(() => rerender({ target: { from: s0, to: s4, mix: 0.9 } }))
    await waitFor(() => expect(result.current).toEqual({ from: s0, to: s4, mix: 1 }), { timeout: 200, interval: 10 })
    expect(performance.now() - mountedAt).toBeLessThan(MIN_CUT_DWELL_SECONDS * 1000)
  })

  it('an ordinary "crossfade" retarget is never held by the wall-clock backstop, even right after a recorded "cut" change', async () => {
    const { result, rerender } = renderHook(({ target, regime }: { target: SceneMix; regime: PresentationRegime }) => usePresentedSceneMix(target, regime), {
      initialProps: { target: alone(s0) as SceneMix, regime: 'crossfade' as PresentationRegime },
    })
    // A crossfade started fresh from a settled pair is unaffected by the backstop even once one
    // has recorded a "last change" — every branch that starts such a transition begins exactly at
    // the settled endpoint (`step`'s own doc comment), so its dominant scene cannot flip sooner
    // than MIN_TRANSITION_SECONDS / 2 (0.8s), comfortably clear of MIN_CUT_DWELL_SECONDS (0.35s):
    // the gate can only ever hold a change that would otherwise land *too soon*, and this one
    // never would.
    act(() => rerender({ target: alone(s1), regime: 'cut' }))
    await waitFor(() => expect(result.current).toEqual(alone(s1)))

    act(() => rerender({ target: alone(s2), regime: 'crossfade' }))
    // A crossfade obeys its own MIN_TRANSITION_SECONDS floor, not the (shorter) backstop window —
    // shortly after the retarget it must still be mid-dissolve, not held frozen on s1.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.current).not.toEqual(alone(s1))
    expect(result.current).not.toEqual(alone(s2))
  })

  it('holds a "crossfade"-regime dominant change too, not only "cut" (regression: the backstop used to gate "cut" only)', async () => {
    // Mounts with the presented mix already close to the 0.5 switch point — `usePresentedSceneMix`
    // mounts at `target` exactly (no animation on mount, see its own doc comment), so this is a
    // legitimate starting state, not an exploit of `step`'s own rate limit (which only bounds
    // movement *after* mount). From here, `step`'s "same pair" branch only has to cross the last
    // sliver of distance to flip dominance again, not a fresh MIN_TRANSITION_SECONDS sweep from an
    // extreme — exactly the situation a `step` continuation resuming from a mix already close to
    // the boundary produces in practice (`presentation.ts`'s own "wall-clock backstop" doc
    // comment), and how the live 266 ms gap at 32x was reproduced.
    const { result, rerender } = renderHook(({ target, regime }: { target: SceneMix; regime: PresentationRegime }) => usePresentedSceneMix(target, regime), {
      initialProps: { target: { from: s0, to: s1, mix: 0.49 } as SceneMix, regime: 'crossfade' as PresentationRegime },
    })
    expect(result.current).toEqual({ from: s0, to: s1, mix: 0.49 })

    // First change: unconstrained (nothing to rate-limit against yet) — a small "crossfade"
    // retarget crosses the 0.5 boundary in one tick since the presented mix started right next to
    // it.
    act(() => rerender({ target: { from: s0, to: s1, mix: 0.9 }, regime: 'crossfade' }))
    await waitFor(() => expect(dominantId(result.current)).toBe(s1.id), { interval: 10 })
    const firstChangeAt = performance.now()

    // Immediately, retarget back the other way, still "crossfade" — again only a sliver of mix
    // separates the current presented state from flipping dominance back to s0.
    act(() => rerender({ target: { from: s0, to: s1, mix: 0.1 }, regime: 'crossfade' }))

    // Held for a little while: still showing s1 as dominant, not yet back to s0.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(dominantId(result.current)).toBe(s1.id)

    await waitFor(() => expect(dominantId(result.current)).toBe(s0.id), { timeout: 2000, interval: 10 })
    const secondChangeAt = performance.now()
    // Same generous slack for test-harness/poll timing noise the "cut" backstop test above uses.
    expect(secondChangeAt - firstChangeAt).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS * 1000 - 100)
  })
})
