// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scene } from '@/types/manifest'

import { dominantScene, type PresentationRegime, type SceneMix } from './scene'
import { MIN_TRANSITION_SECONDS, step, usePresentedSceneMix } from './presentation'

/** Mirrors presentation.ts's private MIN_CUT_DWELL_SECONDS. */
const MIN_CUT_DWELL_SECONDS = 0.35

function scene(id: string, t: number): Scene {
  return { id, t, chapterId: 'ch', image: `${id}.png`, thumbnail: `${id}-t.png`, shot: 'WIDE_RIDGE', title: id, caption: id, width: 1920, height: 1080 }
}

const [s0, s1, s2, s3, s4] = [0, 100, 200, 400, 800].map((t, i) => scene(`s${i}`, t)) as [Scene, Scene, Scene, Scene, Scene]
const RATE = 0.1 / MIN_TRANSITION_SECONDS

const alone = (s: Scene): SceneMix => ({ from: s, to: s, mix: 0 })
const pair = (from: Scene, to: Scene, mix: number): SceneMix => ({ from, to, mix })
const dominantId = (mix: SceneMix) => dominantScene(mix).id

function stepUntil(state: SceneMix, target: SceneMix, dt: number, regime?: PresentationRegime): { state: SceneMix; elapsed: number; seen: Set<string> } {
  let elapsed = 0
  const seen = new Set<string>()
  for (let i = 0; i < 1000 && !(state.from === target.from && state.to === target.to && state.mix === target.mix); i++) {
    state = step(state, target, dt, regime)
    elapsed += dt
    seen.add(state.from.id).add(state.to.id)
  }
  return { state, elapsed, seen }
}

describe('step', () => {
  it.each([0, -1, NaN, Infinity])('returns state unchanged for dt = %p', (dt) => {
    const state = pair(s0, s1, 0.2)
    expect(step(state, pair(s0, s1, 0.9), dt)).toBe(state)
    expect(step(state, pair(s0, s1, 0.9), dt, 'cut')).toBe(state)
  })

  it('moves mix toward the same pair at the rate limit, snapping without overshoot', () => {
    expect(step(pair(s0, s1, 0), pair(s0, s1, 1), 0.1)).toEqual({ from: s0, to: s1, mix: expect.closeTo(RATE) })
    const back = step(pair(s0, s1, 0.5), pair(s0, s1, 0.1), 0.1).mix
    expect(back).toBeLessThan(0.5)
    expect(back).toBeGreaterThanOrEqual(0.1)
    expect(step(pair(s0, s1, 0), pair(s0, s1, 0.9), 100).mix).toBe(0.9)
  })

  it('relabels a reversed pair before moving', () => {
    expect(step(pair(s1, s0, 0.3), pair(s0, s1, 1), 0.1)).toEqual({ from: s0, to: s1, mix: expect.closeTo(0.7 + RATE) })
  })

  it('rebases a settled scene into a neighbouring pair at either end, costing no time', () => {
    expect(step(pair(s0, s1, 1), pair(s1, s2, 0.3), 0.1)).toEqual({ from: s1, to: s2, mix: expect.closeTo(RATE) })
    expect(step(pair(s1, s2, 0), pair(s0, s1, 0.8), 0.1)).toEqual({ from: s0, to: s1, mix: expect.closeTo(1 - RATE) })
    expect(step(pair(s0, s1, 1), pair(s1, s2, 0.3), 100)).toEqual(pair(s1, s2, 0.3))
  })

  it('jumps across several scenes directly, never showing one in between', () => {
    expect(step(alone(s0), alone(s3), 0.1)).toEqual({ from: s0, to: s3, mix: expect.closeTo(RATE) })
    const { state, seen } = stepUntil(alone(s0), alone(s4), 0.05)
    expect(state).toEqual(alone(s4))
    expect([...seen].sort()).toEqual(['s0', 's4'])
  })

  it('mid-transition keeps its endpoints and heads for the end nearer the new target', () => {
    const toward = step(pair(s0, s3, 0.4), pair(s3, s4, 0.1), 0.1)
    expect(toward).toMatchObject({ from: s0, to: s3 })
    expect(toward.mix).toBeGreaterThan(0.4)
    const away = step(pair(s1, s3, 0.4), pair(s0, s1, 0.9), 0.1)
    expect(away).toMatchObject({ from: s1, to: s3 })
    expect(away.mix).toBeLessThan(0.4)
  })

  it('converges exactly and then holds', () => {
    const target = pair(s2, s3, 0.5)
    const { state } = stepUntil(alone(s0), target, 1 / 60)
    expect(state).toEqual(target)
    expect(step(state, target, 1 / 60)).toEqual(target)
  })

  it('never completes a transition faster than MIN_TRANSITION_SECONDS', () => {
    expect(stepUntil(pair(s0, s1, 0), pair(s0, s1, 1), 1 / 60).elapsed).toBeGreaterThanOrEqual(MIN_TRANSITION_SECONDS)
    expect(stepUntil(alone(s0), alone(s4), 1 / 60).elapsed).toBeGreaterThanOrEqual(MIN_TRANSITION_SECONDS)
  })

  it('tracks a target slower than the rate limit exactly', () => {
    let state = pair(s0, s1, 0)
    for (let i = 1; i <= 100; i++) {
      state = step(state, pair(s0, s1, i * 0.01), 0.1)
      expect(state.mix).toBeCloseTo(i * 0.01)
    }
  })

  it('snaps to the dominant scene in the cut regime', () => {
    expect(step(pair(s0, s1, 0), pair(s0, s1, 0.49), 1 / 60, 'cut').mix).toBe(0)
    expect(step(pair(s0, s1, 0), pair(s0, s1, 0.5), 1 / 60, 'cut').mix).toBe(1)
    expect(step(alone(s0), alone(s4), 1 / 60, 'cut')).toEqual(alone(s4))
  })
})

describe('usePresentedSceneMix', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  function advanceUntil(done: () => boolean, maxMs = 3000): number {
    const start = performance.now()
    while (!done()) {
      if (performance.now() - start > maxMs) throw new Error(`condition not met within ${maxMs}ms`)
      advance(16)
    }
    return performance.now()
  }

  function mount(target: SceneMix, regime: PresentationRegime = 'crossfade') {
    return renderHook(({ target, regime }: { target: SceneMix; regime: PresentationRegime }) => usePresentedSceneMix(target, regime), {
      initialProps: { target, regime },
    })
  }

  it('mounts at target, then crossfades to a distant jump over at least MIN_TRANSITION_SECONDS', () => {
    const { result, rerender } = mount(alone(s0))
    expect(result.current).toEqual(alone(s0))
    act(() => rerender({ target: alone(s4), regime: 'crossfade' }))
    const jumpedAt = performance.now()
    advance(200)
    expect(result.current).toMatchObject({ from: s0, to: s4 })
    const settledAt = advanceUntil(() => result.current.mix === 0 && dominantId(result.current) === 's4')
    expect(settledAt - jumpedAt).toBeGreaterThanOrEqual(MIN_TRANSITION_SECONDS * 1000)
  })

  it('cuts the first change promptly but holds a second one for MIN_CUT_DWELL_SECONDS', () => {
    const { result, rerender } = mount(alone(s0), 'cut')
    const start = performance.now()
    act(() => rerender({ target: alone(s1), regime: 'cut' }))
    const first = advanceUntil(() => dominantId(result.current) === 's1')
    expect(first - start).toBeLessThan(MIN_CUT_DWELL_SECONDS * 1000)
    act(() => rerender({ target: alone(s2), regime: 'cut' }))
    advance(100)
    expect(result.current).toEqual(alone(s1))
    const second = advanceUntil(() => dominantId(result.current) === 's2')
    expect(second - first).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS * 1000 - 16)
  })

  it('holds a crossfade dominance flip-back as well', () => {
    const { result, rerender } = mount(pair(s0, s1, 0.49))
    act(() => rerender({ target: pair(s0, s1, 0.9), regime: 'crossfade' }))
    const first = advanceUntil(() => dominantId(result.current) === 's1')
    act(() => rerender({ target: pair(s0, s1, 0.1), regime: 'crossfade' }))
    advance(100)
    expect(dominantId(result.current)).toBe('s1')
    const second = advanceUntil(() => dominantId(result.current) === 's0')
    expect(second - first).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS * 1000 - 16)
  })

  it('does not hold an ordinary crossfade that follows a cut', () => {
    const { result, rerender } = mount(alone(s0))
    act(() => rerender({ target: alone(s1), regime: 'cut' }))
    advanceUntil(() => dominantId(result.current) === 's1')
    act(() => rerender({ target: alone(s2), regime: 'crossfade' }))
    advance(200)
    expect(result.current).not.toEqual(alone(s1))
    expect(result.current).not.toEqual(alone(s2))
  })
})
