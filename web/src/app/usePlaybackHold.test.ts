// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePlaybackHold } from './usePlaybackHold'

function setup(playing: boolean) {
  const setPlaying = vi.fn()
  const hook = renderHook(({ playing }) => usePlaybackHold(playing, setPlaying), { initialProps: { playing } })
  return { setPlaying, hook }
}

describe('usePlaybackHold', () => {
  it('pauses running playback and resumes it once', () => {
    const { setPlaying, hook } = setup(true)
    hook.result.current.pause()
    expect(setPlaying).toHaveBeenLastCalledWith(false)

    hook.rerender({ playing: false })
    hook.result.current.resume()
    expect(setPlaying).toHaveBeenLastCalledWith(true)

    hook.result.current.resume()
    expect(setPlaying).toHaveBeenCalledTimes(2)
  })

  it('neither pauses nor resumes playback that was already paused', () => {
    const { setPlaying, hook } = setup(false)
    hook.result.current.pause()
    hook.result.current.resume()
    expect(setPlaying).not.toHaveBeenCalled()
  })

  it('reads playing as of the latest render', () => {
    const { setPlaying, hook } = setup(false)
    hook.rerender({ playing: true })
    hook.result.current.pause()
    expect(setPlaying).toHaveBeenLastCalledWith(false)
  })

  it('release forgets the remembered state without resuming, and returns it', () => {
    const { setPlaying, hook } = setup(true)
    hook.result.current.pause()
    expect(hook.result.current.release()).toBe(true)
    hook.result.current.resume()
    expect(setPlaying).toHaveBeenCalledTimes(1)
    expect(hook.result.current.release()).toBe(false)
  })

  it('hands a remembered state from one hold to another through release and adopt', () => {
    const setPlaying = vi.fn()
    const { result, rerender } = renderHook(
      ({ playing }) => ({ detail: usePlaybackHold(playing, setPlaying), browser: usePlaybackHold(playing, setPlaying) }),
      { initialProps: { playing: true } },
    )
    result.current.detail.pause()
    rerender({ playing: false })
    result.current.browser.adopt(result.current.detail.release())

    result.current.detail.resume()
    expect(setPlaying).toHaveBeenCalledTimes(1)
    result.current.browser.resume()
    expect(setPlaying).toHaveBeenLastCalledWith(true)
  })

  it('returns the same hold across renders', () => {
    const { hook } = setup(false)
    const first = hook.result.current
    hook.rerender({ playing: true })
    expect(hook.result.current).toBe(first)
  })
})
