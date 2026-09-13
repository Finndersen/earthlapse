import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readHintDismissed, writeHintDismissed } from './hint'

describe('hint persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('defaults to not dismissed', () => {
    expect(readHintDismissed()).toBe(false)
  })

  it('reports dismissed after writeHintDismissed', () => {
    writeHintDismissed()
    expect(readHintDismissed()).toBe(true)
  })

  describe('when sessionStorage throws', () => {
    beforeEach(() => {
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new Error('blocked')
      })
    })
    afterEach(() => vi.restoreAllMocks())

    it('readHintDismissed degrades to false rather than throwing', () => {
      expect(() => readHintDismissed()).not.toThrow()
      expect(readHintDismissed()).toBe(false)
    })

    it('writeHintDismissed is a silent no-op rather than throwing', () => {
      expect(() => writeHintDismissed()).not.toThrow()
    })
  })

  describe('when getItem/setItem throw but sessionStorage itself is accessible', () => {
    it('readHintDismissed degrades to false rather than throwing', () => {
      const spy = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => readHintDismissed()).not.toThrow()
      expect(readHintDismissed()).toBe(false)
      spy.mockRestore()
    })

    it('writeHintDismissed is a silent no-op rather than throwing', () => {
      const spy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => writeHintDismissed()).not.toThrow()
      spy.mockRestore()
    })
  })
})
