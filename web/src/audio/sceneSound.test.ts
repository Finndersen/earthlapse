// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SceneMix } from '@/scene'
import type { Scene, SceneSound } from '@/types/manifest'

import { nextOnceTriggerState, onceSoundOutlived, onceVoiceHasBeenPresented, sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'

function scene(id: string, sound?: SceneSound): Scene {
  return { id, t: 0, chapterId: 'c', image: `${id}.png`, thumbnail: `${id}-t.png`, shot: 'WIDE_RIDGE', title: id, caption: id, width: 100, height: 100, ...(sound ? { sound } : {}) }
}

const mix = (from: Scene, to: Scene, m: number): SceneMix => ({ from, to, mix: m })
const loop = (stem: string, gain: number): SceneSound => ({ stem, mode: 'loop', gain }) as SceneSound
const once = (stem: string): SceneSound => ({ stem, mode: 'once', gain: 1 }) as SceneSound

describe('sceneSoundLoopGains', () => {
  it('weights loop sounds by presentation mix, ignoring once-mode and silent scenes', () => {
    expect(sceneSoundLoopGains(mix(scene('a'), scene('b'), 0.5))).toEqual({})
    expect(sceneSoundLoopGains(mix(scene('a', once('wind')), scene('b'), 0))).toEqual({})
    expect(sceneSoundLoopGains(mix(scene('a', loop('wind', 0.8)), scene('b'), 0.25)).wind).toBeCloseTo(0.6)
    expect(sceneSoundLoopGains(mix(scene('a', loop('wind', 1)), scene('b', loop('water', 1)), 0.4))).toEqual({ wind: 0.6, water: 0.4 })
  })

  it('takes the max, never the sum, of two scenes sharing a stem', () => {
    expect(sceneSoundLoopGains(mix(scene('a', loop('water', 0.6)), scene('b', loop('water', 0.9)), 0.3)).water).toBeCloseTo(0.42, 5)
  })
})

describe('nextOnceTriggerState', () => {
  const withOnce = scene('once-scene', once('fire'))
  const plain = scene('plain')

  it('fires once when a once-mode scene becomes dominant during playback', () => {
    expect(nextOnceTriggerState(mix(plain, withOnce, 0.3), true, true, new Set()).fired).toBeNull()
    const first = nextOnceTriggerState(mix(plain, withOnce, 0.5), true, true, new Set())
    expect(first.fired?.id).toBe('once-scene')
    expect(nextOnceTriggerState(mix(plain, withOnce, 0.96), true, true, first.armedOff).fired).toBeNull()
  })

  it('never fires while scrubbing, or for silent and loop-mode scenes', () => {
    expect(nextOnceTriggerState(mix(withOnce, withOnce, 0), false, false, new Set()).fired).toBeNull()
    expect(nextOnceTriggerState(mix(plain, plain, 0), true, true, new Set()).fired).toBeNull()
    const loopOnly = scene('loop', loop('wind', 1))
    expect(nextOnceTriggerState(mix(loopOnly, loopOnly, 1), true, true, new Set()).fired).toBeNull()
  })

  it('re-arms once the dominant scene moves on', () => {
    const left = nextOnceTriggerState(mix(plain, plain, 0), false, false, new Set(['once-scene']))
    expect(left.armedOff.has('once-scene')).toBe(false)
    expect(nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, left.armedOff).fired?.id).toBe('once-scene')
  })

  it('fires each scene of a dense sweep exactly once', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => scene(id, once('impact'))) as [Scene, Scene, Scene]
    const frames = [mix(plain, a, 0.2), mix(plain, a, 0.6), mix(plain, a, 0.85), mix(a, b, 0.4), mix(a, b, 0.55), mix(a, b, 0.9), mix(b, c, 0.51), mix(b, c, 1)]
    let armedOff: ReadonlySet<string> = new Set()
    const fired: string[] = []
    for (const frame of frames) {
      const result = nextOnceTriggerState(frame, true, true, armedOff)
      armedOff = result.armedOff
      if (result.fired) fired.push(result.fired.id)
    }
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('treats pressing play as not an arrival, including after a pause mid-dwell', () => {
    const pressed = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, false, new Set())
    expect(pressed.fired).toBeNull()
    expect(nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, pressed.armedOff).fired).toBeNull()
    expect(nextOnceTriggerState(mix(plain, withOnce, 0.9), true, false, new Set()).fired).toBeNull()
    const onPlain = nextOnceTriggerState(mix(plain, plain, 0), true, false, new Set())
    expect(nextOnceTriggerState(mix(plain, withOnce, 0.6), true, true, onPlain.armedOff).fired?.id).toBe('once-scene')
  })
})

describe('useSceneSoundOnceTrigger', () => {
  const withOnce = scene('once-scene', once('fire'))
  const plain = scene('plain')

  it.each([
    ['fires on arrival during playback', mix(plain, plain, 0), true, 'once-scene'],
    ['does not fire when play is pressed on the scene', mix(withOnce, withOnce, 0), false, undefined],
  ] as const)('%s', async (_label, initial, initiallyPlaying, expected) => {
    const { result, rerender } = renderHook(({ presented, playing }: { presented: SceneMix; playing: boolean }) => useSceneSoundOnceTrigger(presented, playing), {
      initialProps: { presented: initial as SceneMix, playing: initiallyPlaying },
    })
    await act(async () => rerender({ presented: mix(withOnce, withOnce, 0), playing: true }))
    expect(result.current?.id).toBe(expected)
  })
})

describe('once voice lifetime', () => {
  const launch = scene('launch', once('rocket'))
  const next = scene('next')

  it('latches presented-dominance', () => {
    expect(onceVoiceHasBeenPresented(mix(next, next, 0), 'launch', false)).toBe(false)
    expect(onceVoiceHasBeenPresented(mix(launch, launch, 0), 'launch', false)).toBe(true)
    expect(onceVoiceHasBeenPresented(mix(next, next, 0), 'launch', true)).toBe(true)
  })

  it('ends once presented moves on, or target does if presented never showed the scene', () => {
    expect(onceSoundOutlived(mix(launch, next, 0), mix(launch, next, 0), 'launch', true)).toBe(false)
    expect(onceSoundOutlived(mix(next, next, 0), mix(next, next, 0), 'launch', true)).toBe(true)
    expect(onceSoundOutlived(mix(launch, launch, 0), mix(next, launch, 0.1), 'launch', false)).toBe(false)
    expect(onceSoundOutlived(mix(launch, next, 1), mix(launch, next, 0.2), 'launch', false)).toBe(true)
  })
})
