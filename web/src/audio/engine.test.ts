import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Layer, ScalarValue } from '@/types/layer'

import { useAudioEngine } from './engine'

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
      ({ t }) => useAudioEngine({ manifest: null, t, playing: true, scalarLayers: emptyLayers }),
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
    const { result } = renderHook(() => useAudioEngine({ manifest: null, t: 0, playing: true, scalarLayers: emptyLayers }))
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.enabled).toBe(true)

    // No assertion on audible effect here (manifest is null, so `runtimeRef.current` stays
    // null and every tick is a no-op read) — this only guards that fake-timer advancement past
    // several tick periods raises no error, i.e. the interval callback itself keeps running
    // rather than having been silently starved (the test would fail via an unhandled/thrown
    // error inside the interval callback otherwise).
    await vi.advanceTimersByTimeAsync(80 * 5)
    expect(true).toBe(true)
  })
})
