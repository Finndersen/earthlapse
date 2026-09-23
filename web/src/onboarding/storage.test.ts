// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasSeenTour, markTourSeen } from './storage'

describe('onboarding storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads as not seen when nothing is stored', () => {
    expect(hasSeenTour()).toBe(false)
  })

  it('reads as not seen for a stored value that is not the flag', () => {
    window.localStorage.setItem('earthlapse.onboarding.seen', 'maybe')
    expect(hasSeenTour()).toBe(false)
  })

  it('reads the flag stored under the pre-rename key as seen', () => {
    window.localStorage.setItem('earthtime.onboarding.seen', 'true')
    expect(hasSeenTour()).toBe(true)
  })

  describe('when localStorage throws', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('reads as not seen rather than propagating the failure', () => {
      vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
      expect(hasSeenTour()).toBe(false)
    })

    it('swallows a write failure', () => {
      vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked', 'QuotaExceededError')
      })
      expect(() => markTourSeen()).not.toThrow()
    })
  })
})
