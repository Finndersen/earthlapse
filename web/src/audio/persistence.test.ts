import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, loadAudioPrefs, saveAudioEnabled, saveAudioMasterVolume } from './persistence'

describe('audio persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to on with the default master volume when nothing is stored', () => {
    expect(DEFAULT_ENABLED).toBe(true)
    expect(loadAudioPrefs()).toEqual({ enabled: true, masterVolume: DEFAULT_MASTER_VOLUME })
  })

  it('a stored false survives — a deliberate mute is never overridden by the on-by-default', () => {
    saveAudioEnabled(false)
    expect(loadAudioPrefs()).toEqual({ enabled: false, masterVolume: DEFAULT_MASTER_VOLUME })
  })

  it('a stored true round-trips as on', () => {
    saveAudioEnabled(true)
    expect(loadAudioPrefs().enabled).toBe(true)
  })

  it('round-trips enabled and master volume', () => {
    saveAudioEnabled(true)
    saveAudioMasterVolume(0.35)
    expect(loadAudioPrefs()).toEqual({ enabled: true, masterVolume: 0.35 })
  })

  it('clamps a stored volume outside [0, 1]', () => {
    window.localStorage.setItem('earthtime.audio.masterVolume', '5')
    expect(loadAudioPrefs().masterVolume).toBe(1)
  })

  it('falls back to the default volume for malformed stored data', () => {
    window.localStorage.setItem('earthtime.audio.masterVolume', 'not-a-number')
    expect(loadAudioPrefs().masterVolume).toBe(DEFAULT_MASTER_VOLUME)
  })

  describe('when localStorage throws', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('loadAudioPrefs falls back to the on-by-default / default volume rather than throwing', () => {
      vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
      expect(loadAudioPrefs()).toEqual({ enabled: true, masterVolume: DEFAULT_MASTER_VOLUME })
    })

    it('saveAudioEnabled/saveAudioMasterVolume swallow a write failure', () => {
      vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked', 'QuotaExceededError')
      })
      expect(() => saveAudioEnabled(true)).not.toThrow()
      expect(() => saveAudioMasterVolume(0.5)).not.toThrow()
    })
  })
})
