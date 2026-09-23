import { describe, expect, it } from 'vitest'

import type { Playback } from '@/types/layer'

import {
  activeRate,
  defaultSteadyRate,
  detentCaption,
  detentLabel,
  detentValueText,
  nearestDetentIndex,
  rateDetents,
  SCENES_SPEEDS,
  STEADY_DEFAULT_CROSSING_SECONDS,
  STEADY_RATES,
  stepActiveRate,
  stepDetent,
  withActiveRate,
} from './playbackRates'
import { ROOT_SECTION_ID, sectionById, type SectionId } from './sections'

const playback = (overrides: Partial<Playback> = {}): Playback => ({
  playing: false,
  baseRate: 0.02,
  speed: 1,
  yearsPerSecond: 10,
  mode: 'scenes',
  ...overrides,
})

describe('detent tables', () => {
  it('offers scenes multipliers in powers of two from 1/16x to 64x', () => {
    expect(SCENES_SPEEDS).toEqual([1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64])
  })

  it('offers steady rates on a 1-2-5 sequence from 1 yr/s to 1 Gyr/s', () => {
    expect(STEADY_RATES.slice(0, 7)).toEqual([1, 2, 5, 10, 20, 50, 100])
    expect(STEADY_RATES.at(-1)).toBe(1e9)
    expect(STEADY_RATES).toHaveLength(28)
    for (let i = 1; i < STEADY_RATES.length; i++) {
      const ratio = STEADY_RATES[i]! / STEADY_RATES[i - 1]!
      expect([2, 2.5]).toContain(ratio)
    }
  })

  it('picks the table for the mode', () => {
    expect(rateDetents('scenes')).toBe(SCENES_SPEEDS)
    expect(rateDetents('steady')).toBe(STEADY_RATES)
  })
})

describe('nearestDetentIndex', () => {
  it('finds exact detents', () => {
    expect(nearestDetentIndex(STEADY_RATES, 1)).toBe(0)
    expect(nearestDetentIndex(STEADY_RATES, 500)).toBe(STEADY_RATES.indexOf(500))
  })

  it('rounds in log space', () => {
    expect(STEADY_RATES[nearestDetentIndex(STEADY_RATES, 31)]).toBe(20)
    expect(STEADY_RATES[nearestDetentIndex(STEADY_RATES, 33)]).toBe(50)
  })

  it('clamps to either end', () => {
    expect(nearestDetentIndex(STEADY_RATES, 0.01)).toBe(0)
    expect(nearestDetentIndex(STEADY_RATES, 1e12)).toBe(STEADY_RATES.length - 1)
    expect(nearestDetentIndex(STEADY_RATES, 0)).toBe(0)
    expect(nearestDetentIndex(STEADY_RATES, Number.NaN)).toBe(0)
  })
})

describe('stepDetent', () => {
  it('moves one detent in each direction', () => {
    expect(stepDetent(SCENES_SPEEDS, 1, 'up')).toBe(2)
    expect(stepDetent(SCENES_SPEEDS, 1, 'down')).toBe(0.5)
    expect(stepDetent(STEADY_RATES, 5, 'up')).toBe(10)
    expect(stepDetent(STEADY_RATES, 5, 'down')).toBe(2)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(stepDetent(SCENES_SPEEDS, 64, 'up')).toBe(64)
    expect(stepDetent(SCENES_SPEEDS, 1 / 16, 'down')).toBe(1 / 16)
    expect(stepDetent(STEADY_RATES, 1e9, 'up')).toBe(1e9)
    expect(stepDetent(STEADY_RATES, 1, 'down')).toBe(1)
  })

  it('moves an off-table value to the nearest detent on the requested side', () => {
    expect(stepDetent(STEADY_RATES, 30, 'up')).toBe(50)
    expect(stepDetent(STEADY_RATES, 30, 'down')).toBe(20)
    expect(stepDetent(SCENES_SPEEDS, 1000, 'up')).toBe(64)
    expect(stepDetent(SCENES_SPEEDS, 0.001, 'down')).toBe(1 / 16)
  })

  it('reaches every detent stepping up from the slowest', () => {
    let rate = STEADY_RATES[0]!
    const seen = [rate]
    for (let i = 1; i < STEADY_RATES.length; i++) {
      rate = stepDetent(STEADY_RATES, rate, 'up')
      seen.push(rate)
    }
    expect(seen).toEqual([...STEADY_RATES])
  })
})

describe('defaultSteadyRate', () => {
  const at = (id: SectionId, t: number): number => defaultSteadyRate(sectionById(id).window, t)

  it('is always a steady detent', () => {
    for (const [id, t] of [
      ['earth', 0],
      ['earth', 4.5e9],
      ['cretaceous', 1e8],
      ['modern', 50],
    ] as const) {
      expect(STEADY_RATES).toContain(at(id, t))
    }
  })

  it('sizes the rate to the distance to the present when that is shorter than the section', () => {
    expect(at(ROOT_SECTION_ID, 100)).toBe(1)
    expect(at(ROOT_SECTION_ID, 1200)).toBe(10)
    expect(at(ROOT_SECTION_ID, 0)).toBe(1)
  })

  it('sizes the rate to the section span in deep time', () => {
    expect(at(ROOT_SECTION_ID, 4.5e9)).toBe(5e7)
    expect(at('cretaceous', sectionById('cretaceous').window[1])).toBe(5e5)
  })

  it('gives a few yr/s to a few tens of yr/s across the Holocene human-history sections', () => {
    expect(at('modern', sectionById('modern').window[1])).toBe(1)
    expect(at('medieval-world', sectionById('medieval-world').window[1])).toBe(10)
    expect(at('ancient-civilisations', sectionById('ancient-civilisations').window[1])).toBe(20)
  })

  it('crosses the span of interest in roughly STEADY_DEFAULT_CROSSING_SECONDS', () => {
    const [newest, oldest] = sectionById('holocene').window
    const seconds = (oldest - newest) / at('holocene', oldest)
    expect(seconds).toBeGreaterThan(STEADY_DEFAULT_CROSSING_SECONDS / 2.5)
    expect(seconds).toBeLessThan(STEADY_DEFAULT_CROSSING_SECONDS * 2.5)
  })

  it('never grows as t moves nearer the present within one section', () => {
    let previous = Infinity
    for (const t of [4.5e9, 1e9, 1e7, 1e5, 1e3, 10]) {
      const rate = at(ROOT_SECTION_ID, t)
      expect(rate).toBeLessThanOrEqual(previous)
      previous = rate
    }
  })
})

describe('active rate', () => {
  it('reads and writes the scenes multiplier in scenes mode, leaving the steady rate alone', () => {
    const pb = playback({ mode: 'scenes', speed: 2, yearsPerSecond: 500 })
    expect(activeRate(pb)).toBe(2)
    expect(withActiveRate(pb, 8)).toEqual({ ...pb, speed: 8 })
  })

  it('reads and writes years per second in steady mode, leaving the multiplier alone', () => {
    const pb = playback({ mode: 'steady', speed: 2, yearsPerSecond: 500 })
    expect(activeRate(pb)).toBe(500)
    expect(withActiveRate(pb, 1000)).toEqual({ ...pb, yearsPerSecond: 1000 })
  })

  it('steps the active mode only', () => {
    expect(stepActiveRate(playback({ mode: 'scenes', speed: 1 }), 'up').speed).toBe(2)
    const steady = stepActiveRate(playback({ mode: 'steady', speed: 1, yearsPerSecond: 10 }), 'down')
    expect(steady.yearsPerSecond).toBe(5)
    expect(steady.speed).toBe(1)
  })
})

describe('detent labels', () => {
  it('labels steady detents compactly with a magnitude suffix', () => {
    expect(detentLabel('steady', 1)).toBe('1')
    expect(detentLabel('steady', 500)).toBe('500')
    expect(detentLabel('steady', 2000)).toBe('2k')
    expect(detentLabel('steady', 5e5)).toBe('500k')
    expect(detentLabel('steady', 2e7)).toBe('20M')
    expect(detentLabel('steady', 1e9)).toBe('1G')
  })

  it('labels scenes detents as multipliers, fractions below 1x', () => {
    expect(detentLabel('scenes', 1 / 16)).toBe('1/16×')
    expect(detentLabel('scenes', 1 / 2)).toBe('1/2×')
    expect(detentLabel('scenes', 64)).toBe('64×')
  })

  it('keeps every label within four characters plus the × sign', () => {
    for (const mode of ['scenes', 'steady'] as const) {
      for (const value of rateDetents(mode)) expect(detentLabel(mode, value).replace('×', '').length).toBeLessThanOrEqual(4)
    }
  })

  it('spells the value out for assistive technology', () => {
    expect(detentValueText('steady', 1)).toBe('1 year per second')
    expect(detentValueText('steady', 20)).toBe('20 years per second')
    expect(detentValueText('steady', 5e5)).toBe('500 thousand years per second')
    expect(detentValueText('steady', 1e9)).toBe('1 billion years per second')
    expect(detentValueText('scenes', 1 / 4)).toBe('1/4 times scene pace')
    expect(detentValueText('scenes', 8)).toBe('8 times scene pace')
  })

  it('captions each mode with its unit', () => {
    expect(detentCaption('steady')).toBe('yr/s')
    expect(detentCaption('scenes')).toBe('speed')
  })
})
