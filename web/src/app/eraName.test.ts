import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { eraNameAt } from './eraName'

describe('eraNameAt', () => {
  it.each([
    [0, 'Cenozoic'],
    [20_000, 'Cenozoic'],
    [66e6, 'Cenozoic'],
    [66e6 + 1, 'Mesozoic'],
    [3e8, 'Paleozoic'],
    [1e9, 'Proterozoic'],
    [4.0e9, 'Archean'],
    [EARTH_FORMATION, 'Hadean'],
  ])('t=%d falls in the %s', (t, name) => {
    expect(eraNameAt(t)).toBe(name)
  })

  it('throws outside Earth history rather than inventing a band', () => {
    expect(() => eraNameAt(-1)).toThrow(RangeError)
    expect(() => eraNameAt(EARTH_FORMATION + 1)).toThrow(RangeError)
  })
})
