import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SceneMix } from '@/scene'
import type { Scene } from '@/types/manifest'

import { nextOnceTriggerState, sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    t: 0,
    chapterId: 'chapter',
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
    caption: id,
    width: 100,
    height: 100,
    ...overrides,
  }
}

function mix(from: Scene, to: Scene, m: number): SceneMix {
  return { from, to, mix: m }
}

describe('sceneSoundLoopGains', () => {
  it('is empty when neither scene has a loop-mode sound', () => {
    const a = scene('a')
    const b = scene('b')
    expect(sceneSoundLoopGains(mix(a, b, 0.5))).toEqual({})
  })

  it('weights a single loop-sound scene by its presentation mix', () => {
    const a = scene('a', { sound: { stem: 'wind', mode: 'loop', gain: 0.8 } })
    const b = scene('b')
    expect(sceneSoundLoopGains(mix(a, b, 0.25))).toEqual({ wind: (1 - 0.25) * 0.8 })
    expect(sceneSoundLoopGains(mix(a, b, 1))).toEqual({ wind: 0 })
  })

  it('ignores once-mode sound entirely', () => {
    const a = scene('a', { sound: { stem: 'wind', mode: 'once', gain: 0.8 } })
    const b = scene('b')
    expect(sceneSoundLoopGains(mix(a, b, 0))).toEqual({})
  })

  it('aggregates two scenes sharing a stem with Math.max, never sum', () => {
    const a = scene('a', { sound: { stem: 'water', mode: 'loop', gain: 0.6 } })
    const b = scene('b', { sound: { stem: 'water', mode: 'loop', gain: 0.9 } })
    // from-weight 0.7, to-weight 0.3: from contributes 0.42, to contributes 0.27 — max, not sum.
    const result = sceneSoundLoopGains(mix(a, b, 0.3))
    expect(result.water).toBeCloseTo(0.42, 5)
    expect(result.water!).toBeLessThan(0.6)
  })

  it('two different stems both contribute independently', () => {
    const a = scene('a', { sound: { stem: 'wind', mode: 'loop', gain: 1 } })
    const b = scene('b', { sound: { stem: 'water', mode: 'loop', gain: 1 } })
    expect(sceneSoundLoopGains(mix(a, b, 0.4))).toEqual({ wind: 0.6, water: 0.4 })
  })
})

describe('nextOnceTriggerState', () => {
  const withOnce = scene('once-scene', { sound: { stem: 'fire', mode: 'once', gain: 1 } })
  const plain = scene('plain-scene')

  it('does not fire while scrubbing (playing: false), even settled at an arrival', () => {
    const result = nextOnceTriggerState(mix(withOnce, withOnce, 0), false, new Set())
    expect(result.fired).toBeNull()
  })

  it('does not fire mid-dissolve, even while playing', () => {
    const result = nextOnceTriggerState(mix(plain, withOnce, 0.5), true, new Set())
    expect(result.fired).toBeNull()
  })

  it('fires once settled on a once-mode scene while playing', () => {
    const result = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, new Set())
    expect(result.fired?.id).toBe('once-scene')
    expect(result.armedOff.has('once-scene')).toBe(true)
  })

  it('does not fire again on a second call while still armed off (same dwell)', () => {
    const first = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, new Set())
    const second = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, first.armedOff)
    expect(second.fired).toBeNull()
  })

  it('re-arms the moment the dominant scene moves on, even if it never fired on the way out', () => {
    const armedOff = new Set(['once-scene'])
    // Scrubbed away without playing (never fired again), now dominant scene differs.
    const left = nextOnceTriggerState(mix(plain, plain, 0), false, armedOff)
    expect(left.armedOff.has('once-scene')).toBe(false)

    const returned = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, left.armedOff)
    expect(returned.fired?.id).toBe('once-scene')
  })

  it('never fires a scene with no sound, or loop-mode sound', () => {
    const loopOnly = scene('loop-scene', { sound: { stem: 'wind', mode: 'loop', gain: 1 } })
    expect(nextOnceTriggerState(mix(plain, plain, 0), true, new Set()).fired).toBeNull()
    expect(nextOnceTriggerState(mix(loopOnly, loopOnly, 1), true, new Set()).fired).toBeNull()
  })
})

describe('useSceneSoundOnceTrigger', () => {
  const withOnce = scene('once-scene', { sound: { stem: 'fire', mode: 'once', gain: 1 } })

  it('returns the scene on the render right after settling while playing, then clears', async () => {
    const { result, rerender } = renderHook(
      ({ presented, playing }: { presented: SceneMix; playing: boolean }) => useSceneSoundOnceTrigger(presented, playing),
      { initialProps: { presented: mix(withOnce, withOnce, 0) as SceneMix, playing: false } },
    )
    expect(result.current).toBeNull()

    await act(async () => {
      rerender({ presented: mix(withOnce, withOnce, 0), playing: true })
    })
    expect(result.current?.id).toBe('once-scene')
  })
})
