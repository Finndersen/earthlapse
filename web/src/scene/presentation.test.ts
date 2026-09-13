import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scene } from '@/types/manifest'

import type { SceneMix } from './scene'
import { advance, MIN_TRANSITION_SECONDS, PLAYBACK_HOLD_SECONDS, step, usePresentedSceneMix } from './presentation'
import type { Presentation } from './presentation'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
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

// -------------------------------------------------------------------------- MIN_TRANSITION_SECONDS

describe('MIN_TRANSITION_SECONDS', () => {
  it('is a positive, finite tunable', () => {
    expect(MIN_TRANSITION_SECONDS).toBeGreaterThan(0)
    expect(Number.isFinite(MIN_TRANSITION_SECONDS)).toBe(true)
  })
})

// ------------------------------------------------------------------------------- advance

describe('advance: minimum on-screen hold', () => {
  function held(scene: SceneMix, heldSeconds: number): Presentation {
    return { scene, heldSeconds }
  }

  it('is exactly step when minHoldSeconds is 0', () => {
    const state = held(alone(s0), 0)
    const target = alone(s3)
    expect(advance(state, target, 0.1, 0)).toEqual({ scene: step(alone(s0), target, 0.1), heldSeconds: 0 })
  })

  it('keeps a freshly settled scene on screen until the hold elapses, counting the hold', () => {
    const state = held(alone(s0), 0)
    const result = advance(state, alone(s3), 0.5, 2)
    expect(result).toEqual({ scene: alone(s0), heldSeconds: 0.5 })
  })

  it('starts leaving once the hold has elapsed, resetting the hold', () => {
    const state = held(alone(s0), 1.95)
    const result = advance(state, alone(s3), 0.1, 2)
    expect(result).toEqual({ scene: { from: s0, to: s3, mix: 0.1 / MIN_TRANSITION_SECONDS }, heldSeconds: 0 })
  })

  it('applies a rebase that keeps the same scene on screen even while holding', () => {
    // Settled on s1 as the "to" of (s0, s1); target sits in s1's own hold region of (s1, s2).
    const state = held({ from: s0, to: s1, mix: 1 }, 0.2)
    const result = advance(state, { from: s1, to: s2, mix: 0 }, 0.1, 2)
    expect(result.scene).toEqual({ from: s1, to: s2, mix: 0 })
    expect(result.heldSeconds).toBeCloseTo(0.3)
  })

  it('holds even a same-pair move that would start fading the on-screen scene', () => {
    const state = held({ from: s1, to: s2, mix: 0 }, 0.2)
    const result = advance(state, { from: s1, to: s2, mix: 1 }, 0.1, 2)
    expect(result.scene).toEqual({ from: s1, to: s2, mix: 0 })
  })

  it('never holds mid-transition', () => {
    const state = held({ from: s0, to: s1, mix: 0.5 }, 0)
    const result = advance(state, { from: s0, to: s1, mix: 1 }, 0.1, 2)
    expect(result).toEqual({ scene: { from: s0, to: s1, mix: 0.5 + 0.1 / MIN_TRANSITION_SECONDS }, heldSeconds: 0 })
  })

  it.each([0, -1, NaN])('returns state unchanged for dt = %p', (dt) => {
    const state = held(alone(s0), 0)
    expect(advance(state, alone(s3), dt, 2)).toBe(state)
  })

  it('shows every scene it settles on for the whole hold while the target outruns it', () => {
    // The target races through a new scene every 0.1s, far faster than a transition.
    const scenes = [s0, s1, s2, s3, s4]
    const dt = 1 / 60
    const onScreenId = ({ scene: m }: Presentation): string | null => (m.mix === 0 ? m.from.id : m.mix === 1 ? m.to.id : null)

    let state: Presentation = { scene: alone(s0), heldSeconds: 0 }
    const settledSpans: Array<{ id: string; seconds: number }> = [{ id: 's0', seconds: 0 }]
    for (let frame = 0; frame < 60 * 30; frame++) {
      const target = alone(scenes[Math.min(scenes.length - 1, Math.floor(frame / 6))]!)
      state = advance(state, target, dt, PLAYBACK_HOLD_SECONDS)
      const id = onScreenId(state)
      const current = settledSpans[settledSpans.length - 1]!
      if (id === null) continue
      if (id === current.id) current.seconds += dt
      else settledSpans.push({ id, seconds: 0 })
    }

    expect(state.scene).toEqual(alone(s4))
    // Every scene that was left again (all but the final one) was held for the full hold.
    for (const span of settledSpans.slice(0, -1)) {
      expect(span.seconds + 1e-9).toBeGreaterThanOrEqual(PLAYBACK_HOLD_SECONDS)
    }
    // And the hold skips outrun scenes rather than visiting each one.
    expect(settledSpans.length).toBeLessThan(scenes.length)
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
    const { result } = renderHook(() => usePresentedSceneMix(target, 0))
    expect(result.current).toEqual(target)
  })

  it('catches up to a target that jumps to a distant scene, taking real wall-clock time to do it', async () => {
    const initialTarget = alone(s0)
    const { result, rerender } = renderHook(({ target }) => usePresentedSceneMix(target, 0), {
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
})
