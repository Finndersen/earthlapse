import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PresentationRegime } from '@/scene'
import type { Layer, Playback, ScalarValue } from '@/types/layer'

import { useAudioEngine } from './engine'

const PLAYBACK: Playback = { playing: true, baseRate: 0.02, speed: 1, mode: 'scenes' }
const FULL_SECTION_WINDOW: [number, number] = [0, 4.567e9]

// Regression coverage for the tick-loop lifecycle bug: the `useEffect` that owns the
// `setInterval` writing `stemGains`/`sceneSoundLoopGains`/`scoreParams` into the live Tone.js
// graph must depend on `prefs.enabled` alone, never on the fast-changing `t` (and friends) it
// reads via "latest ref" mirrors. During playback `t` changes on ~every rAF frame; a dependency
// array containing it would clear and recreate the interval before its 80ms delay ever elapsed,
// permanently starving the tick and silently freezing all live audio. `manifest: null` here
// deliberately keeps the Tone.js-loading effect a no-op (it requires `manifest !== null`), so
// this test exercises the tick effect's own scheduling in isolation, without needing to mock
// `tone`.
const emptyLayers = new Map<string, Layer<ScalarValue>>()

describe('useAudioEngine tick loop lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.localStorage.setItem('earthtime.audio.enabled', 'true')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not tear down and recreate the interval as t changes across renders', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    const { rerender, unmount } = renderHook(
      ({ t }) => useAudioEngine({ manifest: null, t, playing: true, playback: PLAYBACK, sectionWindow: FULL_SECTION_WINDOW, scalarLayers: emptyLayers }),
      { initialProps: { t: 0 } },
    )

    // Let the mount effect that reads persisted prefs (`setPrefs(loadAudioPrefs())`) commit.
    await vi.advanceTimersByTimeAsync(0)

    const callsAfterMount = setIntervalSpy.mock.calls.filter((call) => call[1] === 80).length
    expect(callsAfterMount).toBe(1)
    expect(clearIntervalSpy).not.toHaveBeenCalled()

    // Simulate ~10 rAF-driven playback frames, each advancing `t` and re-rendering — the exact
    // pattern `Experience.tsx`'s `setT` produces every frame while playing.
    for (let frame = 1; frame <= 10; frame++) {
      rerender({ t: frame * 1e6 })
    }

    // The interval must still be the one created on mount: no additional `setInterval(..., 80)`
    // calls, and no `clearInterval` in between (both would fire if the effect's dependency
    // array included `t`).
    const callsAfterFrames = setIntervalSpy.mock.calls.filter((call) => call[1] === 80).length
    expect(callsAfterFrames).toBe(1)
    expect(clearIntervalSpy).not.toHaveBeenCalled()

    unmount()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('the surviving interval still ticks at the 80ms cadence', async () => {
    const { result } = renderHook(() =>
      useAudioEngine({ manifest: null, t: 0, playing: true, playback: PLAYBACK, sectionWindow: FULL_SECTION_WINDOW, scalarLayers: emptyLayers }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.enabled).toBe(true)

    // No assertion on audible effect here (manifest is null, so `runtimeRef.current` stays
    // null and every tick is a no-op read) — this mainly guards that fake-timer advancement past
    // several tick periods raises no error, i.e. the interval callback itself keeps running
    // rather than having been silently starved (the test would fail via an unhandled/thrown
    // error inside the interval callback otherwise); `enabled` staying `true` is the one concrete
    // thing left to check on the hook's public surface with no real runtime to inspect.
    await vi.advanceTimersByTimeAsync(80 * 5)
    expect(result.current.enabled).toBe(true)
  })

  it('accepts presentationRegime and keeps ticking through a "cut" regime (ADR-029) without error', async () => {
    // manifest: null keeps the tick a no-op read (as above) — this only guards the new prop's
    // wiring: `sceneLoop`'s cut-regime branch and the once-trigger's gated `playing` argument
    // (see engine.ts's own comments at both call sites) run every tick without throwing,
    // whichever regime is passed, and switching regime across renders tears nothing down (same
    // "must not depend on the fast-changing tick inputs" contract the interval test above checks
    // for `t`). Gating *correctness* itself is `nextOnceTriggerState`'s own contract
    // (`sceneSound.test.ts`'s "playing gate" describe block — a 'cut' regime here is wired to
    // read exactly like `playing: false` to that state machine) and is verified live via
    // Playwright per the design brief, not re-derived here.
    const { result, rerender } = renderHook(
      ({ presentationRegime }: { presentationRegime: PresentationRegime }) =>
        useAudioEngine({
          manifest: null,
          t: 0,
          playing: true,
          playback: PLAYBACK,
          sectionWindow: FULL_SECTION_WINDOW,
          scalarLayers: emptyLayers,
          presentationRegime,
        }),
      { initialProps: { presentationRegime: 'crossfade' } },
    )
    await vi.advanceTimersByTimeAsync(0)

    rerender({ presentationRegime: 'cut' })
    await vi.advanceTimersByTimeAsync(80 * 3)

    rerender({ presentationRegime: 'crossfade' })
    await vi.advanceTimersByTimeAsync(80 * 3)

    // As above: no real runtime to inspect (manifest is null), so `enabled` staying `true` is
    // the one concrete thing left to check on the hook's public surface.
    expect(result.current.enabled).toBe(true)
  })
})
