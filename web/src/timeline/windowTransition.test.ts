import { describe, expect, it } from 'vitest'

import type { TimeWindow } from './scale'
import { interpolateWindow } from './windowTransition'

describe('interpolateWindow', () => {
  it('returns exactly `from` at progress 0 and `to` at progress 1', () => {
    const from: TimeWindow = [1e6, 1e8]
    const to: TimeWindow = [2e7, 3e7]
    expect(interpolateWindow(from, to, 0, 'symlog')).toEqual(from)
    expect(interpolateWindow(from, to, 1, 'symlog')).toEqual(to)
    expect(interpolateWindow(from, to, 0, 'linear')).toEqual(from)
    expect(interpolateWindow(from, to, 1, 'linear')).toEqual(to)
  })

  it('keeps newest <= oldest at every progress', () => {
    const from: TimeWindow = [1e6, 1e8]
    const to: TimeWindow = [5e8, 5.1e8]
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const [newest, oldest] = interpolateWindow(from, to, p, 'symlog')
      expect(newest).toBeLessThanOrEqual(oldest)
    }
  })

  it('clamps progress outside [0, 1]', () => {
    const from: TimeWindow = [0, 1000]
    const to: TimeWindow = [500, 1500]
    expect(interpolateWindow(from, to, -1, 'linear')).toEqual(from)
    expect(interpolateWindow(from, to, 2, 'linear')).toEqual(to)
  })

  it('is pure: identical inputs produce identical output', () => {
    const from: TimeWindow = [1e6, 1e8]
    const to: TimeWindow = [2e7, 3e7]
    expect(interpolateWindow(from, to, 0.4, 'symlog')).toEqual(interpolateWindow(from, to, 0.4, 'symlog'))
  })
})
