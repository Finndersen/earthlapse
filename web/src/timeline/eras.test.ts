import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { eraNameForTime, ERA_BANDS } from './eras'

describe('ERA_BANDS', () => {
  it('is sorted oldest to newest', () => {
    for (let i = 1; i < ERA_BANDS.length; i++) {
      expect(ERA_BANDS[i]!.window[1]).toBeLessThanOrEqual(ERA_BANDS[i - 1]!.window[1])
    }
  })

  it('is contiguous: each band starts exactly where the previous one ends', () => {
    for (let i = 1; i < ERA_BANDS.length; i++) {
      expect(ERA_BANDS[i]!.window[1]).toBe(ERA_BANDS[i - 1]!.window[0])
    }
  })

  it('covers the full domain with no gap or overlap at either end', () => {
    expect(ERA_BANDS[0]!.window[1]).toBe(EARTH_FORMATION)
    expect(ERA_BANDS[ERA_BANDS.length - 1]!.window[0]).toBe(0)
  })

  it('gives every band a positive, ordered [newest, oldest] window', () => {
    for (const band of ERA_BANDS) {
      expect(band.window[0]).toBeLessThan(band.window[1])
    }
  })

  it('has a unique id per band', () => {
    const ids = new Set(ERA_BANDS.map((b) => b.id))
    expect(ids.size).toBe(ERA_BANDS.length)
  })
})

describe('eraNameForTime', () => {
  it('returns the correct era name for a time well inside each band', () => {
    expect(eraNameForTime(EARTH_FORMATION - 1)).toBe('Hadean')
    expect(eraNameForTime(3.5e9)).toBe('Archean')
    expect(eraNameForTime(1e9)).toBe('Proterozoic')
    expect(eraNameForTime(4e8)).toBe('Paleozoic')
    expect(eraNameForTime(1e8)).toBe('Mesozoic')
    expect(eraNameForTime(0)).toBe('Cenozoic')
  })

  it('covers both ends of the full domain', () => {
    expect(eraNameForTime(EARTH_FORMATION)).toBe('Hadean')
    expect(eraNameForTime(0)).toBe('Cenozoic')
  })

  it('resolves an exact band boundary to the older (earlier-listed) band', () => {
    const boundary = ERA_BANDS[0]!.window[0]
    expect(eraNameForTime(boundary)).toBe(ERA_BANDS[0]!.name)
  })

  it('throws for a time outside the domain', () => {
    expect(() => eraNameForTime(-1)).toThrow()
    expect(() => eraNameForTime(EARTH_FORMATION + 1)).toThrow()
  })
})
