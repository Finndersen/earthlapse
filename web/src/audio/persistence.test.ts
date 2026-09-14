import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_MASTER_VOLUME, loadAudioPrefs, saveAudioEnabled, saveAudioMasterVolume } from './persistence'

describe('audio persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to off with the default master volume when nothing is stored', () => {
    expect(loadAudioPrefs()).toEqual({ enabled: false, masterVolume: DEFAULT_MASTER_VOLUME })
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

    it('loadAudioPrefs falls back to off / default rather than throwing', () => {
      vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
      expect(loadAudioPrefs()).toEqual({ enabled: false, masterVolume: DEFAULT_MASTER_VOLUME })
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
