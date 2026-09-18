import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SceneMix } from '@/scene'
import type { Scene } from '@/types/manifest'

import { nextOnceTriggerState, onceSoundOutlived, onceVoiceHasBeenPresented, sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    t: 0,
    chapterId: 'chapter',
    image: `${id}.png`,
    thumbnail: `${id}-thumb.png`,
    shot: 'WIDE_RIDGE',
    title: id,
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
    const result = nextOnceTriggerState(mix(withOnce, withOnce, 0), false, false, new Set())
    expect(result.fired).toBeNull()
  })

  it('does not fire while the once-mode scene is still the minority side of a dissolve', () => {
    // mix < 0.5: `plain` is still dominant (`dominantScene`), so `withOnce` has not arrived yet.
    // wasPlaying: true — an ongoing playback tick, not a fresh press of play.
    const result = nextOnceTriggerState(mix(plain, withOnce, 0.3), true, true, new Set())
    expect(result.fired).toBeNull()
  })

  it('fires the instant the once-mode scene becomes dominant (mix crosses 0.5), not only once fully settled at 1 — the fix for once sounds never firing in densely-scened clusters, where the rate-limited presented mix can be re-targeted before it ever reaches exactly 1 (ADR-023 amendment 2026-09-15)', () => {
    const result = nextOnceTriggerState(mix(plain, withOnce, 0.5), true, true, new Set())
    expect(result.fired?.id).toBe('once-scene')
    expect(result.armedOff.has('once-scene')).toBe(true)
  })

  it('fires once settled on a once-mode scene while playing (already playing, not a fresh press)', () => {
    const result = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, new Set())
    expect(result.fired?.id).toBe('once-scene')
    expect(result.armedOff.has('once-scene')).toBe(true)
  })

  it('does not fire again on a second call while still armed off (same dwell), even as mix keeps moving toward 1 without ever settling there — the densely-scened-cluster case', () => {
    const first = nextOnceTriggerState(mix(plain, withOnce, 0.5), true, true, new Set())
    const second = nextOnceTriggerState(mix(plain, withOnce, 0.73), true, true, first.armedOff)
    const third = nextOnceTriggerState(mix(plain, withOnce, 0.96), true, true, second.armedOff)
    expect(second.fired).toBeNull()
    expect(third.fired).toBeNull()
  })

  it('re-arms the moment the dominant scene moves on, even if it never fired on the way out', () => {
    const armedOff = new Set(['once-scene'])
    // Scrubbed away without playing (never fired again), now dominant scene differs.
    const left = nextOnceTriggerState(mix(plain, plain, 0), false, false, armedOff)
    expect(left.armedOff.has('once-scene')).toBe(false)

    // Scrubbed back onto it while already playing (wasPlaying: true) — this is a scrub-driven
    // arrival during ongoing playback, not a play-button press, so it must still fire.
    const returned = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, left.armedOff)
    expect(returned.fired?.id).toBe('once-scene')
  })

  it('fires each once-mode scene in a dense cluster exactly once, even when a later target re-targets before the presented mix would have settled at any of them — a pure simulation of the diagnosed bug', () => {
    const a = scene('a', { sound: { stem: 'impact', mode: 'once', gain: 1 } })
    const b = scene('b', { sound: { stem: 'impact', mode: 'once', gain: 1 } })
    const c = scene('c', { sound: { stem: 'impact', mode: 'once', gain: 1 } })
    // A sequence of presented mixes as `presentation.ts`'s `step` would actually produce while
    // chasing a fast-moving target across a-> b -> c without ever reporting an exact settle at
    // either a or b: mix keeps climbing toward 1 for the current pair, gets re-targeted onto the
    // next pair partway through (the "different pair, mid-transition" branch), and only the last
    // one in the sequence happens to reach exactly 1. Playback is already running throughout
    // (wasPlaying: true on every call) — this simulates a continuous playback sweep, not a
    // play-button press.
    const frames: SceneMix[] = [
      mix(plain, a, 0.2),
      mix(plain, a, 0.6), // a becomes dominant here — should fire
      mix(plain, a, 0.85), // still a, re-targeted before reaching 1 — must not re-fire
      mix(a, b, 0.4), // still a dominant (mix < 0.5) — must not fire b yet
      mix(a, b, 0.55), // b becomes dominant here — should fire
      mix(a, b, 0.9), // still b — must not re-fire
      mix(b, c, 0.51), // c becomes dominant here — should fire
      mix(b, c, 1), // settles — must not re-fire
    ]
    let armedOff: ReadonlySet<string> = new Set<string>()
    const fired: string[] = []
    for (const frame of frames) {
      const result = nextOnceTriggerState(frame, true, true, armedOff)
      armedOff = result.armedOff
      if (result.fired) fired.push(result.fired.id)
    }
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('never fires a scene with no sound, or loop-mode sound', () => {
    const loopOnly = scene('loop-scene', { sound: { stem: 'wind', mode: 'loop', gain: 1 } })
    expect(nextOnceTriggerState(mix(plain, plain, 0), true, true, new Set()).fired).toBeNull()
    expect(nextOnceTriggerState(mix(loopOnly, loopOnly, 1), true, true, new Set()).fired).toBeNull()
  })

  describe('the "playing gate" (2026-09-15 correction) — pressing play is not itself an arrival', () => {
    it('does not fire when playing transitions false -> true while already sitting on a once-mode scene, but arms it off', () => {
      const result = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, false, new Set())
      expect(result.fired).toBeNull()
      expect(result.armedOff.has('once-scene')).toBe(true)
    })

    it('does not fire on the play-transition even mid-dissolve onto a once-mode scene', () => {
      const result = nextOnceTriggerState(mix(plain, withOnce, 0.9), true, false, new Set())
      expect(result.fired).toBeNull()
    })

    it('a scene armed off by the play-transition still does not re-fire on the very next tick, still playing', () => {
      const first = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, false, new Set())
      const second = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, first.armedOff)
      expect(second.fired).toBeNull()
    })

    it('pausing then resuming within the same dwell does not re-fire a scene that already fired under playback', () => {
      const fired = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, true, new Set())
      expect(fired.fired?.id).toBe('once-scene')

      const paused = nextOnceTriggerState(mix(withOnce, withOnce, 0), false, true, fired.armedOff)
      expect(paused.fired).toBeNull()

      const resumed = nextOnceTriggerState(mix(withOnce, withOnce, 0), true, false, paused.armedOff)
      expect(resumed.fired).toBeNull()
    })

    it('an arrival that happens while already playing (not on the play-transition itself) still fires normally', () => {
      // Paused on `plain`, then played forward through `withOnce` — the play-transition tick
      // landed on `plain` (no sound), and only a later, already-playing tick reaches `withOnce`.
      const onPlain = nextOnceTriggerState(mix(plain, plain, 0), true, false, new Set())
      expect(onPlain.fired).toBeNull()

      const arrived = nextOnceTriggerState(mix(plain, withOnce, 0.6), true, true, onPlain.armedOff)
      expect(arrived.fired?.id).toBe('once-scene')
    })
  })
})

describe('useSceneSoundOnceTrigger', () => {
  const withOnce = scene('once-scene', { sound: { stem: 'fire', mode: 'once', gain: 1 } })
  const plain = scene('plain-scene')

  it('fires when the dominant scene changes to a once-mode scene while already playing', async () => {
    const { result, rerender } = renderHook(
      ({ presented, playing }: { presented: SceneMix; playing: boolean }) => useSceneSoundOnceTrigger(presented, playing),
      { initialProps: { presented: mix(plain, plain, 0) as SceneMix, playing: true } },
    )
    expect(result.current).toBeNull()

    await act(async () => {
      rerender({ presented: mix(withOnce, withOnce, 0), playing: true })
    })
    expect(result.current?.id).toBe('once-scene')
  })

  it('does not fire when playback resumes while already sitting on a once-mode scene (2026-09-15 "playing gate" correction) — pressing play is not an arrival', async () => {
    const { result, rerender } = renderHook(
      ({ presented, playing }: { presented: SceneMix; playing: boolean }) => useSceneSoundOnceTrigger(presented, playing),
      { initialProps: { presented: mix(withOnce, withOnce, 0) as SceneMix, playing: false } },
    )
    expect(result.current).toBeNull()

    await act(async () => {
      rerender({ presented: mix(withOnce, withOnce, 0), playing: true })
    })
    expect(result.current).toBeNull()
  })
})

describe('onceVoiceHasBeenPresented', () => {
  const launch = scene('launch', { sound: { stem: 'rocket', mode: 'once', gain: 0.9 } })
  const next = scene('next')

  it('latches true the moment presented shows the scene as dominant, and stays true after it moves on', () => {
    expect(onceVoiceHasBeenPresented(mix(next, next, 0), 'launch', false)).toBe(false)
    expect(onceVoiceHasBeenPresented(mix(launch, launch, 0), 'launch', false)).toBe(true)
    // Once latched, stays true even once presented has moved past the scene again.
    expect(onceVoiceHasBeenPresented(mix(next, next, 0), 'launch', true)).toBe(true)
  })
})

describe('onceSoundOutlived', () => {
  const launch = scene('launch', { sound: { stem: 'rocket', mode: 'once', gain: 0.9 } })
  const next = scene('next')

  describe('once the scene has been presented-dominant (hasBeenPresented: true) — reads presented alone', () => {
    it('is false while the fired scene is still the dominant on-screen scene', () => {
      expect(onceSoundOutlived(mix(launch, launch, 1), mix(launch, launch, 1), 'launch', true)).toBe(false)
      expect(onceSoundOutlived(mix(launch, next, 0), mix(launch, next, 0), 'launch', true)).toBe(false)
    })

    it('is true once presented has moved on to another scene, regardless of target', () => {
      expect(onceSoundOutlived(mix(launch, next, 1), mix(launch, next, 1), 'launch', true)).toBe(true)
      expect(onceSoundOutlived(mix(next, next, 0), mix(next, next, 0), 'launch', true)).toBe(true)
    })
  })

  describe('before the scene has ever been presented-dominant (hasBeenPresented: false) — reads target instead', () => {
    it('is false while a lagging presented mix still shows the previous scene, as long as target is still on the fired scene — the exact bug this correction fixes: a voice fired off target must not be faded on the very next tick just because presented has not caught up yet', () => {
      // target has already arrived at `launch`; presented (rate-limited) is still catching up
      // and shows `next` receding — this is exactly what happens on the tick right after a once
      // voice fires off the raw target mix.
      expect(onceSoundOutlived(mix(launch, launch, 0), mix(next, launch, 0.1), 'launch', false)).toBe(false)
    })

    it('is true once target itself has moved past the scene, even though presented never once showed it dominant — engine.ts\'s apollo-11-launch rebase case, where `presented` can skip a scene entirely', () => {
      expect(onceSoundOutlived(mix(launch, next, 1), mix(launch, next, 0.2), 'launch', false)).toBe(true)
    })
  })
})
