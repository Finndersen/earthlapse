// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Layer, Playback, ScalarValue } from '@/types/layer'
import type { Manifest } from '@/types/manifest'

import { useAudioEngine } from './engine'

// A minimal Tone stand-in. `start` resolves only when a test calls `resolveStart`, standing in
// for the browser's first user gesture.
const toneTestState = vi.hoisted(() => {
  class FakeParam {
    rampTo = vi.fn()
  }
  class FakeNode {
    gain = new FakeParam()
    frequency = new FakeParam()
    detune = new FakeParam()
    connect(): this {
      return this
    }
    start(): this {
      return this
    }
    toDestination(): this {
      return this
    }
    dispose(): void {}
  }
  let resolveStart: (() => void) | null = null
  return {
    resolveStart: () => resolveStart?.(),
    module: {
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveStart = resolve
          }),
      ),
      Gain: FakeNode,
      Filter: FakeNode,
      Oscillator: FakeNode,
      Tremolo: FakeNode,
      LFO: FakeNode,
      Player: FakeNode,
      ToneAudioBuffer: FakeNode,
      getContext: () => ({ state: 'running' as const }),
    },
  }
})

vi.mock('tone', () => toneTestState.module)

const EMPTY_MANIFEST: Manifest = {
  schemaVersion: 1,
  buildId: 'test',
  assetBase: '/media',
  scenes: [],
  chapters: [],
  layers: [],
  events: [],
  audioStems: [],
  credits: [],
}

const PLAYBACK: Playback = { playing: true, baseRate: 0.02, speed: 1, mode: 'scenes' }
const FULL_SECTION_WINDOW: [number, number] = [0, 4.567e9]

const emptyLayers = new Map<string, Layer<ScalarValue>>()

// The tick interval must depend on the enabled preference alone, never on per-frame inputs
// such as t: re-creating it every frame would starve it and freeze live audio.
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

    await vi.advanceTimersByTimeAsync(0)

    const callsAfterMount = setIntervalSpy.mock.calls.filter((call) => call[1] === 80).length
    expect(callsAfterMount).toBe(1)
    expect(clearIntervalSpy).not.toHaveBeenCalled()

    for (let frame = 1; frame <= 10; frame++) {
      rerender({ t: frame * 1e6 })
    }

    const callsAfterFrames = setIntervalSpy.mock.calls.filter((call) => call[1] === 80).length
    expect(callsAfterFrames).toBe(1)
    expect(clearIntervalSpy).not.toHaveBeenCalled()

    unmount()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })
})

// `enabled` is the stored preference; `active` is whether audio has actually started.
describe('useAudioEngine "active" — real audio state vs. the stored preference', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reports enabled but not active while Tone.start() is still waiting on a user gesture', async () => {
    const { result } = renderHook(() =>
      useAudioEngine({
        manifest: EMPTY_MANIFEST,
        t: 0,
        playing: true,
        playback: PLAYBACK,
        sectionWindow: FULL_SECTION_WINDOW,
        scalarLayers: emptyLayers,
      }),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.enabled).toBe(true)
    expect(toneTestState.module.start).toHaveBeenCalledTimes(1)
    expect(result.current.active).toBe(false)

    await vi.advanceTimersByTimeAsync(80 * 5)
    expect(result.current.active).toBe(false)
    expect(result.current.enabled).toBe(true)
  })

  it('becomes active once Tone.start() resolves', async () => {
    const { result } = renderHook(() =>
      useAudioEngine({
        manifest: EMPTY_MANIFEST,
        t: 0,
        playing: true,
        playback: PLAYBACK,
        sectionWindow: FULL_SECTION_WINDOW,
        scalarLayers: emptyLayers,
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.active).toBe(false)

    await act(async () => {
      toneTestState.resolveStart()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.active).toBe(true)
    expect(result.current.enabled).toBe(true)
  })

  it('drops active back to false the instant the viewer mutes, even mid-start', async () => {
    const { result } = renderHook(() =>
      useAudioEngine({
        manifest: EMPTY_MANIFEST,
        t: 0,
        playing: true,
        playback: PLAYBACK,
        sectionWindow: FULL_SECTION_WINDOW,
        scalarLayers: emptyLayers,
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    await act(async () => {
      toneTestState.resolveStart()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.active).toBe(true)

    act(() => {
      result.current.setEnabled(false)
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(result.current.enabled).toBe(false)
    expect(result.current.active).toBe(false)
  })
})
